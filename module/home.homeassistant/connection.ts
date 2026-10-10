import { ApiError, sys } from "@qino/qino";
import { observed, providers, reported } from "@qino/qino/home";

import type { App } from "@qino/qino";
import type { Action, Call, Entity } from "@qino/qino/home";

const TIMEOUT = 15_000;
const HEARTBEAT = 30_000;
const RETRY_MAX = 30_000;

type State = { entity_id: string; state: string; attributes: Record<string, unknown>; last_updated: string };
type Field = {
  name?: string; description?: string; required?: boolean; example?: unknown; default?: unknown;
  selector?: Record<string, Record<string, unknown> | null>; fields?: Record<string, Field>;
};
type Filter = { domain?: string | string[] };
type Services = Record<string, Record<string, {
  name?: string;
  description?: string;
  fields?: Record<string, Field>;
  target?: { entity?: Filter | Filter[] };
  response?: { optional: boolean };
}>>;
type Change = { entity_id: string; new_state: State | null; old_state: State | null };
type Pending = { resolve(value: unknown): void; reject(reason: unknown): void; timer: ReturnType<typeof setTimeout> };

/** One app's authenticated session. Socket loss invalidates observations and pending commands. */
export class Connection {
  #app: App;
  #provider: number;
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

  constructor(app: App, provider: number, url: string, token: string, signal: AbortSignal) {
    this.#app = app;
    this.#provider = provider;
    this.#url = url;
    this.#token = token;
    this.#signal = signal;
    signal.addEventListener("abort", () => {
      clearTimeout(this.#timer);
      this.#drop(new ApiError(503, "Home Assistant connection was closed"));
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
        input: inputOf(info.fields ?? {}),
        ...(info.target ? { targets: this.#targets(info.target.entity ?? {}) } : {}),
      })));
  }

  /** Entities matching a target's domain filters; other filters (integration, features) are left to the call. */
  #targets(filters: Filter | Filter[]) {
    const domains = [filters].flat().map(({ domain }) => domain === undefined ? undefined : [domain].flat());
    return [...this.#states.keys()].filter((id) =>
      domains.some((list) => !list || list.includes(id.slice(0, id.indexOf(".")))));
  }

  async call(action: string, { entities, data = {} }: Call): Promise<unknown> {
    await this.#available();
    const [domain, service, extra] = action.split(".");
    if (!domain || !service || extra !== undefined)
      throw new ApiError(400, "Expected a discovered Home Assistant action ID");
    const services = await this.#request<Services>({ type: "get_services" });
    const info = Object.hasOwn(services, domain) && Object.hasOwn(services[domain], service)
      ? services[domain][service] : undefined;
    if (!info) throw new ApiError(404, "Home Assistant action was not found");
    if (entities?.length === 0) throw new ApiError(400, "Explicit targets must not be empty");
    return this.#request({
      type: "call_service", domain, service, service_data: data,
      ...(entities ? { target: { entity_id: entities } } : {}),
      ...(info.response ? { return_response: true } : {}),
    });
  }

  async #available() {
    await this.#connecting;
    if (this.#invalid)
      throw new ApiError(503, "Home Assistant rejected its access token; update the provider's access token");
    if (this.#signal.aborted || !this.#ready) throw new ApiError(503, "Home Assistant is not connected");
  }

  async #open() {
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
    const time = Date.now();
    for (const state of this.#states.values()) {
      observed(this.#app, this.#provider, state.entity_id, entityOf(state), time)
        .catch((error) => console.error("home.homeassistant:", error));
    }
    const heartbeat = () => {
      if (this.#socket !== socket || this.#signal.aborted) return;
      this.#heartbeat = setTimeout(() => {
        this.#request({ type: "ping" })
          .then(heartbeat, () => this.#drop(new ApiError(503, "Home Assistant heartbeat failed")));
      }, HEARTBEAT);
      sys.unrefTimer(this.#heartbeat);
    };
    heartbeat();
  }

  #observe(change: Change) {
    if (this.#signal.aborted || !this.#ready) return;
    const state = change.new_state, current = this.#states.get(change.entity_id);
    // A snapshot may already contain a later observation than a buffered event.
    if (state && current && Date.parse(state.last_updated) < Date.parse(current.last_updated)) return;
    if (state) this.#states.set(change.entity_id, state);
    else this.#states.delete(change.entity_id);
    reported(this.#app, this.#provider, change.entity_id, state ? entityOf(state) : null,
      change.old_state ? entityOf(change.old_state) : null).catch((e) => console.error("home:input listener:", e));
  }

  #request<T = unknown>(command: Record<string, unknown>): Promise<T> {
    const socket = this.#socket;
    if (!socket || socket.readyState !== WebSocket.OPEN)
      return Promise.reject(new ApiError(503, "Home Assistant is not connected"));
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

  #drop(error: ApiError) {
    const socket = this.#socket;
    this.#socket = undefined;
    this.#ready = false;
    // A lost connection is an observation gap, not a device change; closing it deliberately is neither.
    const time = Date.now();
    if (!this.#signal.aborted) for (const state of this.#states.values()) {
      observed(this.#app, this.#provider, state.entity_id, { ...entityOf(state), available: false }, time)
        .catch((error) => console.error("home.homeassistant:", error));
    }
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
    sys.unrefTimer(this.#timer);
    this.#retry = Math.min(this.#retry * 2, RETRY_MAX);
  }
}

// Selectors whose value is a plain string or number; anything else stays free-form JSON.
const STRINGS = new Set(["text", "entity", "device", "area", "floor", "label", "state", "theme", "icon",
  "config_entry", "conversation_agent", "language", "template", "datetime", "date", "time", "statistic", "addon"]);
const NUMBERS = new Set(["number", "color_temp"]);

/** Home Assistant's field selectors as the JSON schema of an action's data. */
function inputOf(fields: Record<string, Field>) {
  // Sections group fields for display only; their fields are top-level data keys.
  const flat = Object.entries(fields)
    .flatMap(([key, field]) => field.fields ? Object.entries(field.fields) : [[key, field] as const]);
  const properties = Object.fromEntries(flat.map(([key, field]) => {
    const [kind = "", options] = Object.entries(field.selector ?? {})[0] ?? [];
    const { min, max, step, multiple, options: values = [] } = (options ?? {}) as Record<string, unknown>;
    const one = kind === "boolean" ? { type: "boolean" }
      : NUMBERS.has(kind) ? {
        type: "number", minimum: min, maximum: max, multipleOf: typeof step === "number" ? step : undefined,
      }
      : kind === "select" ? {
        type: "string", enum: (values as unknown[]).map((value) => (value as { value?: unknown })?.value ?? value),
      }
      : STRINGS.has(kind) ? { type: "string" }
      : {};
    const schema = multiple && "type" in one ? { type: "array", items: one } : one;
    // JSON round trip drops undefined keys.
    return [key, JSON.parse(JSON.stringify({
      ...schema, title: field.name, description: field.description, default: field.default,
      examples: field.example === undefined ? undefined : [field.example],
    }))];
  }));
  const required = flat.filter(([, field]) => field.required).map(([key]) => key);
  return { type: "object", properties, ...required.length ? { required } : {} };
}

function entityOf(state: State) {
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

const CONNECTIONS = Symbol("home.homeassistant");
type Sessions = Map<number, { session: Connection; controller: AbortController }>;
const owned = (app: App) => app as App & { [CONNECTIONS]?: Sessions };

export function connection(app: App, id: number): Connection {
  const session = owned(app)[CONNECTIONS]?.get(id)?.session;
  if (!session) throw new ApiError(503, "Home Assistant provider is disabled or not configured");
  return session;
}

/** Starts in the background, so an unreachable home never prevents Qino from booting. */
export async function init(app: App, { signal }: { signal: AbortSignal }): Promise<void> {
  const sessions: Sessions = new Map();
  owned(app)[CONNECTIONS] = sessions;
  signal.addEventListener("abort", () => {
    for (const { controller } of sessions.values()) controller.abort();
    sessions.clear();
    if (owned(app)[CONNECTIONS] === sessions) delete owned(app)[CONNECTIONS];
  }, { once: true });
  const reload = async (id?: number) => {
    const rows = await providers(app);
    if (signal.aborted) return;
    const selected = rows.filter((row) =>
      row.adapter === "homeassistant" && row.enabled && (id === undefined || row.id === id));
    if (id !== undefined) { sessions.get(id)?.controller.abort(); sessions.delete(id); }
    for (const row of selected) {
      const { url, accessToken: token } = row.config;
      const endpoint = typeof url === "string" ? URL.parse(url) : null;
      if (!endpoint || !["http:", "https:", "ws:", "wss:"].includes(endpoint.protocol)) continue;
      if (endpoint.username || endpoint.password || typeof token !== "string" || !token) continue;
      endpoint.protocol = endpoint.protocol === "https:" || endpoint.protocol === "wss:" ? "wss:" : "ws:";
      endpoint.pathname = endpoint.pathname.replace(/\/api\/websocket\/?$|\/$/, "") + "/api/websocket";
      endpoint.search = "";
      endpoint.hash = "";
      const controller = new AbortController();
      const session = new Connection(app, row.id, endpoint.href, token, controller.signal);
      sessions.set(row.id, { session, controller });
      session.start();
    }
  };
  let pending = Promise.resolve();
  app.on("home:provider", ({ id, adapter, previousAdapter }) => {
    if (adapter !== "homeassistant" && previousAdapter !== "homeassistant") return;
    return pending = pending.catch(() => {}).then(() => reload(id));
  }, { signal });
  await reload();
}
