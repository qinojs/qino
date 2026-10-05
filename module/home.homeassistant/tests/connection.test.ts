import { App } from "@qino/qino";
import { entities, save } from "@qino/qino/home";
import { run } from "@qino/qino/sandbox.flow";
import { assertEquals, assertRejects, Emitter } from "@qino/qino/tests";

import { homeProvider } from "../mod.ts";
import { init } from "../plugin.ts";

import type { Flow } from "@qino/qino/sandbox.flow";

const state = (value = "off", id = "light.kitchen", time = "2026-10-04T10:00:00Z") => ({
  entity_id: id, state: value, attributes: { friendly_name: "Kitchen", brightness: 20 }, last_updated: time,
});
const services = { light: { turn_on: { name: "Turn on", fields: { brightness: { required: false } } } } };
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Speed up protocol deadlines while keeping real timer cancellation and resource checks. */
async function withDeadlines(fn: () => Promise<void>) {
  const original = globalThis.setTimeout;
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    const [handler, ms, ...rest] = args;
    return original(handler, ms === 15_000 ? 20 : ms === 30_000 ? 5 : ms, ...rest);
  }) as typeof setTimeout;
  try { await fn(); }
  finally { globalThis.setTimeout = original; }
}
const appOf = (url = "http://house.test/proxy/", token = "private-token") => Object.assign(new Emitter(), {
  db: { query: () => Promise.resolve([{ id: 1, name: "First", adapter: "homeassistant", config: { url, accessToken: token }, enabled: true }]) },
}) as unknown as App;

Deno.test("homeassistant reads full history with app credentials and leaves live observations unchanged", () => withServer(async () => {
  const app = appOf("wss://house.test/proxy/"), ctrl = new AbortController(), original = globalThis.fetch;
  const requests: { url: URL; init?: RequestInit }[] = [], changes: unknown[] = [];
  app.on("home:change", (event) => { changes.push(event); });
  let fail = false;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: new URL(String(input)), init });
    return Promise.resolve(fail ? new Response("private upstream detail", { status: 503 }) : Response.json([[
      state("unavailable", "light.kitchen", "2026-10-03T01:00:00Z"),
      state("on", "light.kitchen", "2026-10-03T02:00:00Z"),
      state("on", "light.other"),
    ]]));
  }) as typeof fetch;
  try {
    await init(app, { signal: ctrl.signal });
    const period = { start: "2026-10-03T00:00:00.000Z", end: "2026-10-04T00:00:00.000Z" };
    const values = await homeProvider.history!(app, 1, "light.kitchen", period);
    assertEquals(values.length, 2);
    assertEquals(values[0].available, false);
    assertEquals(values[1].updated, "2026-10-03T02:00:00Z");
    assertEquals(values[1].attributes.brightness, 20);
    const { url, init: request } = requests[0];
    assertEquals(url.protocol, "https:");
    assertEquals(decodeURIComponent(url.pathname), "/proxy/api/history/period/" + period.start);
    assertEquals(url.searchParams.get("end_time"), period.end);
    assertEquals(url.searchParams.get("filter_entity_id"), "light.kitchen");
    assertEquals(request?.headers, { Authorization: "Bearer private-token" });
    assertEquals(request?.redirect, "error");
    assertEquals((await homeProvider.entities(app, 1))[0].state, "off");
    assertEquals(changes, []);
    fail = true;
    await assertRejects(() => homeProvider.history!(app, 1, "light.kitchen", period), Error, "failed (503)");
    assertEquals(requests.length, 2);
    ctrl.abort();
    assertEquals(request?.signal?.aborted, true);
  } finally { ctrl.abort(); globalThis.fetch = original; }
}));

/** A protocol peer, not a mock of the connection's implementation. No network permissions needed. */
async function withServer(fn: (server: {
  sockets: { url: string; close(): void; emit(message: unknown): void }[];
  commands: Record<string, unknown>[];
  handle?: (socket: { close(): void; emit(message: unknown): void }, command: Record<string, unknown>) => boolean;
}) => Promise<void>) {
  const original = globalThis.WebSocket;
  const server: Parameters<typeof fn>[0] = { sockets: [], commands: [] };
  class Socket {
    static OPEN = 1;
    readyState = 1;
    url: string;
    onmessage?: (event: { data: string }) => void;
    onclose?: () => void;
    onerror?: () => void;
    constructor(url: string) {
      this.url = url;
      server.sockets.push(this);
      this.emit({ type: "auth_required" });
    }
    emit(message: unknown) {
      queueMicrotask(() => { if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(message) }); });
    }
    send(data: string) {
      const command = JSON.parse(data);
      server.commands.push(command);
      if (server.handle?.(this, command)) return;
      if (command.type === "auth") return this.emit({ type: "auth_ok" });
      if (command.type === "ping") return this.emit({ type: "pong", id: command.id });
      const result = command.type === "get_states" ? [state()]
        : command.type === "get_services" ? services : { context: { id: "ack" }, response: null };
      this.emit({ type: "result", id: command.id, success: true, result });
    }
    close() {
      if (this.readyState !== 1) return;
      this.readyState = 3;
      queueMicrotask(() => this.onclose?.());
    }
  }
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  try { await fn(server); }
  finally {
    for (const socket of server.sockets) socket.close();
    await tick();
    globalThis.WebSocket = original;
  }
}

Deno.test("homeassistant authenticates, discovers and sends native actions without faking device states", () => withServer(async (server) => {
  const app = appOf(), ctrl = new AbortController(), changes: unknown[] = [];
  app.on("home:change", (e) => { changes.push(e); });
  try {
    await init(app, { signal: ctrl.signal });
    const entities = await homeProvider.entities(app, 1);
    assertEquals(server.sockets[0].url, "ws://house.test/proxy/api/websocket");
    assertEquals(server.commands[0], { type: "auth", access_token: "private-token" });
    assertEquals(entities[0], {
      id: "light.kitchen", name: "Kitchen", state: "off", attributes: { friendly_name: "Kitchen", brightness: 20 },
      available: true, updated: "2026-10-04T10:00:00Z",
    });
    entities[0].attributes.brightness = 255;
    assertEquals((await homeProvider.entities(app, 1))[0].attributes.brightness, 20);
    assertEquals(await homeProvider.actions(app, 1), [{
      id: "light.turn_on", name: "Turn on", description: undefined, fields: { brightness: { required: false } },
    }]);
    await homeProvider.call(app, 1, "light.turn_on", { entities: ["light.kitchen"], data: { brightness: 100 } });
    const command = server.commands.find((c) => c.type === "call_service")!;
    assertEquals({ ...command, id: 0 }, {
      type: "call_service", domain: "light", service: "turn_on", target: { entity_id: ["light.kitchen"] },
      service_data: { brightness: 100 }, id: 0,
    });
    assertEquals((await homeProvider.entities(app, 1))[0].state, "off");
    assertEquals(changes, []);
    const updated = state("on", "light.kitchen", "2026-10-04T10:01:00Z");
    server.sockets[0].emit({ type: "event", event: { data: { entity_id: "light.kitchen", old_state: state(), new_state: updated } } });
    await tick();
    assertEquals((await homeProvider.entities(app, 1))[0].state, "on");
    assertEquals((changes[0] as { provider: number }).provider, 1);
    await assertRejects(() => homeProvider.call(app, 1, "light.turn_on", { entities: [] }), Error, "must not be empty");
    await assertRejects(() => homeProvider.call(app, 1, "light.missing", {}), Error, "not found");
    await assertRejects(() => homeProvider.call(app, 1, "__proto__.toString", {}), Error, "not found");
    assertEquals(server.commands.filter((c) => c.type === "call_service").length, 1);
  } finally { ctrl.abort(); await tick(); }
}));

Deno.test("homeassistant buffers changes during snapshots and handles creation, unavailability and removal", () => withServer(async (server) => {
  const app = appOf(), ctrl = new AbortController();
  const seen: { id: string; entity: { state: string } | null; previous: unknown }[] = [];
  app.on("home:change", (e) => { seen.push(e); });
  server.handle = (socket, command) => {
    if (command.type !== "get_states") return false;
    socket.emit({ type: "event", event: { data: {
      entity_id: "light.kitchen", old_state: state(), new_state: state("on", "light.kitchen", "2026-10-04T10:02:00Z"),
    } } });
    socket.emit({ type: "result", id: command.id, success: true, result: [state()] });
    return true;
  };
  try {
    await init(app, { signal: ctrl.signal });
    assertEquals((await homeProvider.entities(app, 1))[0].state, "on");
    const socket = server.sockets[0];
    socket.emit({ type: "event", event: { data: { entity_id: "sensor.extra", old_state: null, new_state: state("unavailable", "sensor.extra") } } });
    await tick();
    assertEquals((await homeProvider.entities(app, 1)).find((e) => e.id === "sensor.extra")?.available, false);
    socket.emit({ type: "event", event: { data: { entity_id: "sensor.extra", old_state: state("unavailable", "sensor.extra"), new_state: null } } });
    await tick();
    assertEquals((await homeProvider.entities(app, 1)).length, 1);
    assertEquals(seen.map((e) => [e.id, e.entity?.state ?? null, e.previous === null]), [
      ["light.kitchen", "on", false], ["sensor.extra", "unavailable", true], ["sensor.extra", null, false],
    ]);
  } finally { ctrl.abort(); await tick(); }
}));

Deno.test("homeassistant isolates apps and rejects pending calls on unlink", () => withServer(async (server) => {
  const one = appOf(), two = appOf("https://other.test/api/websocket", "other-token");
  const a = new AbortController(), b = new AbortController(), c = new AbortController();
  try {
    await init(one, { signal: a.signal });
    await init(two, { signal: b.signal });
    await Promise.all([homeProvider.entities(one, 1), homeProvider.entities(two, 1)]);
    assertEquals(server.sockets.map((s) => s.url), ["ws://house.test/proxy/api/websocket", "wss://other.test/api/websocket"]);
    server.sockets[0].emit({ type: "event", event: { data: {
      entity_id: "light.kitchen", old_state: state(), new_state: state("on", "light.kitchen", "2026-10-04T10:02:00Z"),
    } } });
    await tick();
    assertEquals((await homeProvider.entities(one, 1))[0].state, "on");
    assertEquals((await homeProvider.entities(two, 1))[0].state, "off");
    server.handle = (_socket, command) => command.type === "call_service";
    const pending = assertRejects(() => homeProvider.call(one, 1, "light.turn_on", {}), Error, "closed");
    await tick();
    a.abort();
    await pending;
    await assertRejects(() => homeProvider.entities(one, 1), Error, "not configured");
    assertEquals((await homeProvider.entities(two, 1))[0].state, "off");
    await init(one, { signal: c.signal });
    await homeProvider.entities(one, 1);
    assertEquals(server.sockets.length, 3);
  } finally { a.abort(); b.abort(); c.abort(); await tick(); }
}));

Deno.test("homeassistant reconnects and resubscribes without replaying an interrupted command", () => withServer(async (server) => {
  const app = appOf(), ctrl = new AbortController(), seen: unknown[] = [], observed: { entity: { available: boolean } }[] = [];
  app.on("home:change", (e) => { seen.push(e); });
  app.on("home:observe", (e) => { observed.push(e as typeof observed[number]); });
  server.handle = (socket, command) => {
    if (command.type !== "call_service") return false;
    socket.close();
    return true;
  };
  try {
    await init(app, { signal: ctrl.signal });
    await homeProvider.entities(app, 1);
    await assertRejects(() => homeProvider.call(app, 1, "light.turn_on", {}), Error, "lost");
    await assertRejects(() => homeProvider.entities(app, 1), Error, "not connected");
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assertEquals((await homeProvider.entities(app, 1))[0].state, "off");
    assertEquals(server.commands.filter((c) => c.type === "subscribe_events").length, 2);
    assertEquals(server.commands.filter((c) => c.type === "call_service").length, 1);
    // A lost connection is observed as unavailable, but is no device change for rules.
    assertEquals(seen.length, 0);
    assertEquals(observed.map((e) => e.entity.available), [true, false, true]);
  } finally { ctrl.abort(); await tick(); }
}));

Deno.test("homeassistant supports response actions, surfaces remote failures and stops after rejected authentication", () => withServer(async (server) => {
  const app = appOf(), ctrl = new AbortController();
  server.handle = (socket, command) => {
    if (command.type === "get_services") {
      socket.emit({ type: "result", id: command.id, success: true, result: {
        weather: { get_forecasts: { response: { optional: false } } },
      } });
      return true;
    }
    if (command.type === "call_service") {
      socket.emit({ type: "result", id: command.id, success: false, error: { message: "Denied by Home Assistant" } });
      return true;
    }
    return false;
  };
  try {
    await init(app, { signal: ctrl.signal });
    await assertRejects(() => homeProvider.call(app, 1, "weather.get_forecasts", {}), Error, "Denied by Home Assistant");
    assertEquals(server.commands.find((c) => c.type === "call_service")?.return_response, true);
  } finally { ctrl.abort(); await tick(); }
  const rejected = new AbortController(), other = appOf();
  server.handle = (socket, command) => {
    if (command.type !== "auth") return false;
    socket.emit({ type: "auth_invalid" });
    return true;
  };
  try {
    await init(other, { signal: rejected.signal });
    await assertRejects(() => homeProvider.entities(other, 1), Error, "rejected its access token");
    const attempts = server.commands.filter((c) => c.type === "auth").length;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assertEquals(server.commands.filter((c) => c.type === "auth").length, attempts);
  } finally { rejected.abort(); await tick(); }
}));

Deno.test("homeassistant leaves invalid persisted configurations dormant", async () => {
  for (const url of ["", "http://user:password@house.test", "file:///tmp/ha"]) {
    const app = appOf(url), ctrl = new AbortController();
    await init(app, { signal: ctrl.signal });
    await assertRejects(() => homeProvider.entities(app, 1), Error, "not configured");
    ctrl.abort();
  }
});

Deno.test("homeassistant bounds command and authentication waits without retrying actions", () => withDeadlines(() => withServer(async (server) => {
  const app = appOf(), ctrl = new AbortController();
  server.handle = (_socket, command) => command.type === "call_service";
  try {
    await init(app, { signal: ctrl.signal });
    await assertRejects(() => homeProvider.call(app, 1, "light.turn_on", {}), Error, "outcome may be unknown");
    assertEquals(server.commands.filter((c) => c.type === "call_service").length, 1);
    await assertRejects(() => homeProvider.entities(app, 1), Error, "not connected");
  } finally { ctrl.abort(); await tick(); }
  const other = appOf(), auth = new AbortController();
  server.handle = (_socket, command) => command.type === "auth";
  try {
    await init(other, { signal: auth.signal });
    await assertRejects(() => homeProvider.entities(other, 1), Error, "not connected");
  } finally { auth.abort(); await tick(); }
})));

Deno.test("homeassistant detects a silent connection through its heartbeat", () => withDeadlines(() => withServer(async (server) => {
  const app = appOf(), ctrl = new AbortController();
  server.handle = (_socket, command) => command.type === "ping";
  try {
    await init(app, { signal: ctrl.signal });
    await homeProvider.entities(app, 1);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assertEquals(server.commands.filter((c) => c.type === "ping").length, 1);
    await assertRejects(() => homeProvider.entities(app, 1), Error, "not connected");
  } finally { ctrl.abort(); await tick(); }
})));

Deno.test("home modules link through Qino and a flow dispatches with its owner's rights", () => withServer(async (server) => {
  const dir = await Deno.makeTempDir();
  const app = new App({ dir, db: "sqlite::memory:" });
  app.modules.add(new URL("../../home/plugin.ts", import.meta.url));
  try {
    await app.init();
    await app.settings.core.url("https://qino.test/");
    await app.db.table("usr").insert({ id: 7, username: "home@example.test", active: true, superuser: true });
    await app.modules.import(new URL("../plugin.ts", import.meta.url).href);
    await app.modules.link("home.homeassistant");
    await save(app, { name: "House", adapter: "homeassistant", config: { url: "http://house.test/", accessToken: "private-token" } });
    assertEquals((await entities(app))[0].provider, 1);
    const flow: Flow = {
      description: "Turn on the light", on: { host: "app", event: "home:change" }, owner: 7,
      tools: ["home_provider_action_post"],
      steps: [{
        description: "Call the common home API",
        fn: async (_e, { tools }) => {
          await tools.home_provider_action_post({ provider: 1, action: "light.turn_on", entities: ["light.kitchen"] });
          return true;
        },
      }],
    };
    const dry = await run(app, flow, {});
    assertEquals(dry.end, "done");
    assertEquals(dry.steps[0].calls[0].skipped, true);
    assertEquals(server.commands.filter((c) => c.type === "call_service").length, 0);
    const live = await run(app, { ...flow, test: false }, {});
    assertEquals(live.end, "done");
    assertEquals(server.commands.filter((c) => c.type === "call_service").length, 1);
    app.modules.unlink("home.homeassistant");
    assertEquals(await entities(app), []);
    await assertRejects(() => entities(app, 1), Error, "not linked");
    await app.modules.link("home.homeassistant");
    assertEquals((await entities(app))[0].provider, 1);
  } finally {
    app.modules.unlink("home.homeassistant");
    await new Promise((resolve) => setTimeout(resolve, 60)); // session writes are deferred by 50 ms
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
}));

Deno.test("homeassistant runs independent provider instances in the same App and reconfigures only the selected connection", () => withServer(async (server) => {
  const app = appOf(), ctrl = new AbortController();
  const rows = [
    { id: 1, name: "First", adapter: "homeassistant", config: { url: "http://first.test/", accessToken: "first-token" }, enabled: true },
    { id: 2, name: "Second", adapter: "homeassistant", config: { url: "http://second.test/", accessToken: "second-token" }, enabled: true },
  ];
  Object.defineProperty(app.db, "query", { value: () => Promise.resolve(rows) });
  try {
    await init(app, { signal: ctrl.signal });
    await Promise.all([homeProvider.entities(app, 1), homeProvider.entities(app, 2)]);
    assertEquals(server.sockets.map((socket) => socket.url), ["ws://first.test/api/websocket", "ws://second.test/api/websocket"]);
    server.sockets[0].emit({ type: "event", event: { data: { entity_id: "light.kitchen", old_state: state(), new_state: state("on") } } });
    await tick();
    assertEquals((await homeProvider.entities(app, 1))[0].state, "on");
    assertEquals((await homeProvider.entities(app, 2))[0].state, "off");
    rows[1].enabled = false;
    await app.fire("home:provider", { id: 2, adapter: "homeassistant", previousAdapter: "homeassistant" });
    await assertRejects(() => homeProvider.entities(app, 2), Error, "not configured");
    assertEquals((await homeProvider.entities(app, 1))[0].state, "on");
    assertEquals(server.sockets.length, 2);
  } finally { ctrl.abort(); await tick(); }
}));
