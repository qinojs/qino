import { ApiError } from "@qino/qino";
import { changed } from "@qino/qino/home";

import type { App } from "@qino/qino";
import type { Action, Call, Entity } from "@qino/qino/home";

const TIMEOUT = 15_000;
const HEARTBEAT = 30_000;
const RETRY_MAX = 30_000;

type State = { entity_id: string; state: string; attributes: Record<string, unknown>; last_updated: string };
type Services = Record<string, Record<string, {
  name?: string;
  description?: string;
  fields?: Record<string, unknown>;
  response?: { optional: boolean };
}>>;
type Change = { entity_id: string; new_state: State | null; old_state: State | null };
type Pending = { resolve(value: unknown): void; reject(reason: unknown): void; timer: ReturnType<typeof setTimeout> };

/** One app's authenticated session. Socket loss invalidates observations and pending commands. */
export class Connection {
  #app: App;
  #url: string;
  #token: string;
  #signal: AbortSignal;
  #socket?: WebSocket;
  #connecting?: Promise<void>;
  #ready = false;
  #invalid = false;
  #retry = 1000;
  #timer?: ReturnType<typeof setTimeout>;
  #heartbeat?: ReturnType<typeof setTimeout>;
  #seq = 0;
  #pending = new Map<number, Pending>();
  #states = new Map<string, State>();

  constructor(app: App, url: string, token: string, signal: AbortSignal) {
    this.#app = app;
    this.#url = url;
    this.#token = token;
    this.#signal = signal;
    signal.addEventListener("abort", () => {
      clearTimeout(this.#timer);
      this.#drop(new ApiError(503, "Home Assistant module was unlinked"));
    }, { once: true });
  }

  start(): void {
    if (this.#signal.aborted) return;
    this.#connecting = this.#open().catch(() => {
      this.#drop(new ApiError(503, "Home Assistant connection failed"));
    }).finally(() => { this.#connecting = undefined; });
  }

  async entities(): Promise<Entity[]> {
    await this.#available();
    return [...this.#states.values()].map(entityOf);
  }

  async history(id: string, { start, end }: { start: string; end: string }): Promise<Entity[]> {
    await this.#available();
    const url = new URL(this.#url);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = url.pathname.replace(/websocket$/, "history/period/" + encodeURIComponent(start));
    url.searchParams.set("end_time", end);
    url.searchParams.set("filter_entity_id", id);
    // Full observations retain attributes and changes to attributes, not just numeric states.
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.#token}` },
      signal: AbortSignal.any([this.#signal, AbortSignal.timeout(TIMEOUT)]),
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ApiError(502, `Home Assistant history request failed (${response.status})`);
    }
    const states = await response.json() as State[][];
    return states.flat().filter((state) => state.entity_id === id).map(entityOf);
  }

  async actions(): Promise<Action[]> {
    await this.#available();
    // Refresh on discovery: integrations can be added while this session stays open.
    const services = await this.#request<Services>({ type: "get_services" });
    return Object.entries(services).flatMap(([domain, services]) =>
      Object.entries(services).map(([service, info]) => ({
        id: `${domain}.${service}`,
        name: info.name || `${domain}.${service}`,
        description: info.description,
        fields: structuredClone(info.fields ?? {}),
      })));
  }

  async call(action: string, { entities, data = {} }: Call): Promise<unknown> {
    await this.#available();
    const [domain, service, extra] = action.split(".");
    if (!domain || !service || extra !== undefined) throw new ApiError(400, "Expected a discovered Home Assistant action ID");
    const services = await this.#request<Services>({ type: "get_services" });
    const info = Object.hasOwn(services, domain) && Object.hasOwn(services[domain], service) ? services[domain][service] : undefined;
    if (!info) throw new ApiError(404, "Home Assistant action was not found");
    if (entities?.length === 0) throw new ApiError(400, "Explicit targets must not be empty");
    return this.#request({
      type: "call_service", domain, service, service_data: data,
      ...(entities ? { target: { entity_id: entities } } : {}),
      ...(info.response ? { return_response: true } : {}),
    });
  }

  async #available(): Promise<void> {
    await this.#connecting;
    if (this.#invalid) throw new ApiError(503, "Home Assistant rejected its access token; update accessToken and relink the module");
    if (this.#signal.aborted || !this.#ready) throw new ApiError(503, "Home Assistant is not connected");
  }

  async #open(): Promise<void> {
    const socket = this.#socket = new WebSocket(this.#url);
    const buffered: Change[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Authentication timed out")), TIMEOUT);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        error ? reject(error) : resolve();
      };
      socket.onclose = () => {
        finish(new Error("Socket closed"));
        if (this.#socket === socket) this.#drop(new ApiError(503, "Home Assistant connection was lost"));
      };
      socket.onerror = () => {
        finish(new Error("Socket error"));
        if (this.#socket === socket) this.#drop(new ApiError(503, "Home Assistant connection failed"));
      };
      socket.onmessage = ({ data }) => {
        if (this.#socket !== socket || this.#signal.aborted) return;
        try {
          const message = JSON.parse(data);
          if (message.type === "auth_required") socket.send(JSON.stringify({ type: "auth", access_token: this.#token }));
          else if (message.type === "auth_ok") finish();
          else if (message.type === "auth_invalid") {
            this.#invalid = true; // credentials need changing; reconnecting would repeat the same rejection
            finish(new Error("Authentication rejected"));
          } else if (message.type === "result" || message.type === "pong") {
            const pending = this.#pending.get(message.id);
            if (!pending) return;
            clearTimeout(pending.timer);
            this.#pending.delete(message.id);
            if (message.type === "pong" || message.success) pending.resolve(message.result);
            else pending.reject(new ApiError(502, message.error?.message || "Home Assistant command failed"));
          } else if (message.type === "event") {
            const change = message.event.data as Change;
            this.#ready ? this.#observe(change) : buffered.push(change);
          }
        } catch {
          finish(new Error("Invalid WebSocket message"));
          this.#drop(new ApiError(502, "Invalid Home Assistant message"));
        }
      };
    });
    // Subscribe before taking the snapshot; changes during loading are replayed afterwards.
    await this.#request({ type: "subscribe_events", event_type: "state_changed" });
    const states = await this.#request<State[]>({ type: "get_states" });
    if (this.#socket !== socket || this.#signal.aborted) return;
    this.#states = new Map(states.map((state) => [state.entity_id, state]));
    this.#ready = true;
    this.#retry = 1000;
    for (const change of buffered) this.#observe(change);
    const heartbeat = () => {
      if (this.#socket !== socket || this.#signal.aborted) return;
      this.#heartbeat = setTimeout(() => {
        this.#request({ type: "ping" }).then(heartbeat, () => this.#drop(new ApiError(503, "Home Assistant heartbeat failed")));
      }, HEARTBEAT);
      Deno.unrefTimer(this.#heartbeat);
    };
    heartbeat();
  }

  #observe(change: Change): void {
    if (this.#signal.aborted || !this.#ready) return;
    const state = change.new_state, current = this.#states.get(change.entity_id);
    // A snapshot may already contain a later observation than a buffered event.
    if (state && current && Date.parse(state.last_updated) < Date.parse(current.last_updated)) return;
    if (state) this.#states.set(change.entity_id, state);
    else this.#states.delete(change.entity_id);
    changed(this.#app, "homeassistant", change.entity_id, state ? entityOf(state) : null,
      change.old_state ? entityOf(change.old_state) : null).catch((e) => console.error("home:change listener:", e));
  }

  #request<T = unknown>(command: Record<string, unknown>): Promise<T> {
    const socket = this.#socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new ApiError(503, "Home Assistant is not connected"));
    const id = ++this.#seq;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new ApiError(504, "Home Assistant command timed out; its outcome may be unknown"));
        this.#drop(new ApiError(503, "Home Assistant connection timed out"));
      }, TIMEOUT);
      this.#pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      try { socket.send(JSON.stringify({ ...command, id })); }
      catch {
        this.#drop(new ApiError(503, "Home Assistant command could not be sent"));
      }
    });
  }

  #drop(error: ApiError): void {
    const socket = this.#socket;
    this.#socket = undefined;
    this.#ready = false;
    this.#states.clear();
    clearTimeout(this.#heartbeat);
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    socket?.close();
    if (this.#signal.aborted || this.#invalid || this.#timer !== undefined) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.start();
    }, this.#retry);
    Deno.unrefTimer(this.#timer);
    this.#retry = Math.min(this.#retry * 2, RETRY_MAX);
  }
}

function entityOf(state: State): Entity {
  return {
    id: state.entity_id,
    name: String(state.attributes.friendly_name ?? state.entity_id),
    state: state.state,
    attributes: structuredClone(state.attributes),
    available: state.state !== "unavailable" && state.state !== "unknown",
    updated: state.last_updated,
    ...(typeof state.attributes.unit_of_measurement === "string" ? { unit: state.attributes.unit_of_measurement } : {}),
  };
}

const CONNECTION = Symbol("home.homeassistant");
const owned = (app: App) => app as App & { [CONNECTION]?: Connection };

export function connection(app: App): Connection {
  const connection = owned(app)[CONNECTION];
  if (!connection) throw new ApiError(503, "Configure home.homeassistant.url and accessToken, then relink the module");
  return connection;
}

/** Starts in the background, so an unreachable home never prevents Qino from booting. */
export async function init(app: App, { signal }: { signal: AbortSignal }): Promise<void> {
  const settings = app.settings["home.homeassistant"];
  const [url, token] = await Promise.all([settings.url, settings.accessToken]);
  if (!url || !token || signal.aborted) return;
  const endpoint = new URL(String(url));
  if (!["http:", "https:", "ws:", "wss:"].includes(endpoint.protocol) || endpoint.username || endpoint.password)
    throw new Error("home.homeassistant.url must be an HTTP(S) or WebSocket URL without credentials");
  endpoint.protocol = endpoint.protocol === "https:" || endpoint.protocol === "wss:" ? "wss:" : "ws:";
  endpoint.pathname = endpoint.pathname.replace(/\/$/, "").replace(/\/api\/websocket$/, "") + "/api/websocket";
  endpoint.search = "";
  endpoint.hash = "";
  const session = new Connection(app, endpoint.href, String(token), signal);
  owned(app)[CONNECTION] = session;
  signal.addEventListener("abort", () => {
    if (owned(app)[CONNECTION] === session) delete owned(app)[CONNECTION];
  }, { once: true });
  session.start();
}
