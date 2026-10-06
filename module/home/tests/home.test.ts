import { App, requestStorage, toTools } from "@qino/qino";
import { assertEquals, assertRejects, testContext } from "@qino/qino/tests";

import {
  actions, call, changed, command, commands, configure, entities, provider, providers, remove, removeCommand, run, save,
  saveCommand,
} from "../mod.ts";
import { api } from "../plugin.ts";

async function fixture() {
  const dir = await Deno.makeTempDir({ prefix: "qino-home-test-" }), app = new App({ dir, db: "sqlite::memory:" });
  await Deno.writeTextFile(`${dir}/plugin.ts`, `
export const homeProvider = {
  name: "fake",
  schema: { type: "object", additionalProperties: false, properties: {
    url: { type: "string" }, token: { type: "string", writeOnly: true },
    accounts: { type: "array", items: { type: "object", properties: { token: { type: "string", writeOnly: true }, label: { type: "string" } } } },
    nested: { type: "object", properties: { password: { type: "string", writeOnly: true }, label: { type: "string" } } },
  } },
  entities: async (_app, id) => [{ id: "same", name: "Endpoint", state: id, attributes: {}, available: true }],
  actions: async () => [{ id: "set", name: "Set" }],
  call: async (_app, provider, action, input) => ({ provider, action, input }),
};
`);
  app.modules.add(new URL("../plugin.ts", import.meta.url));
  app.modules.add(new URL(`file://${dir}/plugin.ts`), "fake.adapter");
  await app.init();
  return { app, close: async () => { await app.db.close(); await Deno.remove(dir, { recursive: true }); } };
}
const url = "https://first.test/";
const input = { name: "First", adapter: "fake", config: { url, token: "private", nested: { password: "nested-private", label: "Public" } } };

Deno.test("home persists distinct provider instances and dispatches overlapping entity identities by numeric ID", async () => {
  const { app, close } = await fixture();
  try {
    const first = await save(app, input);
    const second = await save(app, { ...input, name: "Second", config: { ...input.config, url: "https://second.test/" } });
    assertEquals([first, second], [1, 2]);
    assertEquals((await providers(app)).map((row) => [row.id, row.adapter, row.config.url]), [[1, "fake", url], [2, "fake", "https://second.test/"]]);
    assertEquals((await entities(app)).map((row) => [row.id, row.provider, row.state]), [["same", 1, 1], ["same", 2, 2]]);
    assertEquals((await actions(app, second))[0].provider, second);
    assertEquals(await call(app, second, "set", { data: { value: false } }), { provider: 2, action: "set", input: { data: { value: false } } });
    await save(app, { ...input, id: first, enabled: false });
    await assertRejects(() => entities(app, first), Error, "disabled");
    await save(app, { ...input, id: first, enabled: true });
    // An unlinked or failing provider is left out of the combined list.
    await app.db.query`UPDATE home_provider SET adapter = ${"unlinked"} WHERE id = ${first}`;
    assertEquals((await entities(app)).map((row) => row.provider), [2]);
    await assertRejects(() => entities(app, first), Error, "not linked");
    await remove(app, second);
    await assertRejects(() => provider(app, second), Error, "not found");
  } finally { await close(); }
});

Deno.test("home provider configuration validates before writes, retains blank nested secrets and never includes credentials in events", async () => {
  const { app, close } = await fixture();
  try {
    const events: unknown[] = [];
    app.on("home:provider", (event) => { events.push(event); });
    const id = await save(app, input);
    await save(app, { ...input, id, config: { token: "", nested: { password: "", label: "Changed" } } });
    assertEquals((await provider(app, id)).config, { url, token: "private", nested: { password: "nested-private", label: "Changed" } });
    assertEquals(JSON.stringify(events).includes("private"), false);
    await assertRejects(() => save(app, { ...input, id, config: { unknown: true } }), Error, "configuration");
    assertEquals((await provider(app, id)).config.nested, { password: "nested-private", label: "Changed" });
    await assertRejects(() => save(app, { ...input, adapter: "absent" }), Error, "not linked");
  } finally { await close(); }
});

Deno.test("home tools redact credentials, enforce superuser access and dispatch validated provider IDs", async () => {
  const { app, close } = await fixture();
  try {
    const id = await save(app, { ...input, config: { ...input.config, accounts: [{ token: "array-private", label: "Public account" }] } }), tools = toTools({ home: api });
    const list = tools.find((tool) => tool.name === "home_providers_get")!;
    const action = tools.find((tool) => tool.name === "home_provider_action_post")!;
    const put = tools.find((tool) => tool.name === "home_datapoint_put")!;
    const point = await configure(app, { provider: id, entity: "same", unit: "°C" });
    const ctx = await testContext({ app, set: { user: { id: 7, superuser: true } } });
    await requestStorage.run(ctx, async () => {
      const rows = await list.execute({}, ctx) as { config: unknown }[];
      assertEquals(rows[0].config, { url, nested: { label: "Public" }, accounts: [{ label: "Public account" }] });
      // Only name, interval and recording are editable; the interpretation is fixed.
      await assertRejects(() => put.execute({ datapoint: point, unit: "K" }, ctx), Error, "Validation failed");
      assertEquals(await put.execute({ datapoint: point, name: "Renamed" }, ctx), { id: point });
      assertEquals(await action.execute({ provider: id, action: "set", data: { value: false } }, ctx), { provider: id, action: "set", input: { data: { value: false }, entities: undefined } });
      await assertRejects(() => action.execute({ provider: id, action: "set", entities: "bad" }, ctx), Error, "Validation failed");
    });
    for (const user of [null, { id: 8 }]) {
      const other = await testContext({ app, set: { user } });
      await requestStorage.run(other, () => assertRejects(() => list.execute({}, other), Error, "Access denied"));
    }
  } finally { await close(); }
});

Deno.test("home observations and cleanup remain isolated between Apps", async () => {
  const one = await fixture(), two = await fixture(), controller = new AbortController();
  try {
    const seen: unknown[] = [], other: unknown[] = [];
    one.app.on("home:change", (event) => { seen.push(event); }, { signal: controller.signal });
    two.app.on("home:change", (event) => { other.push(event); });
    const entity = { id: "same", name: "Endpoint", state: false, attributes: {}, available: true };
    await changed(one.app, 1, "same", entity, null);
    controller.abort();
    await changed(one.app, 1, "same", null, entity);
    assertEquals(seen.length, 1);
    assertEquals(other.length, 0);
    assertEquals(await providers(two.app), []);
  } finally { await one.close(); await two.close(); }
});

Deno.test("home stores commands as named action calls and runs them with run-time data", async () => {
  const { app, close } = await fixture();
  try {
    const provider = await save(app, input);
    const id = await saveCommand(app, { provider, name: "Lamp", action: "set", targets: ["same"], data: { level: 1 } });
    assertEquals(await command(app, id),
      { id, provider, name: "Lamp", action: "set", targets: ["same"], data: { level: 1 }, parameter: "" });
    assertEquals(await run(app, id, { data: { level: 5, fade: true } }),
      { provider, action: "set", input: { entities: ["same"], data: { level: 5, fade: true } } });
    await assertRejects(() => run(app, id, { value: 3 }), Error, "no value");
    // The value fills the parameter path, creating objects on the way; stored siblings stay.
    await saveCommand(app, { id, data: { message: "brightness", data: { keep: 1 } }, parameter: "data.command" });
    assertEquals(await run(app, id, { value: 153 }), { provider, action: "set",
      input: { entities: ["same"], data: { message: "brightness", data: { keep: 1, command: 153 } } } });
    await saveCommand(app, { id, data: { level: 1 }, parameter: "" });
    await saveCommand(app, { id, targets: [] });
    assertEquals(await run(app, id), { provider, action: "set", input: { data: { level: 1 } } });
    for (const bad of [{ provider, name: "", action: "set" }, { provider, name: "X", action: "set", targets: "same" },
      { provider, name: "X", action: "set", data: [] }, { provider: 99, name: "X", action: "set" },
      { provider, name: "X", action: "set", parameter: "data.__proto__" }, { provider, name: "X", action: "set", parameter: "a..b" }])
      await assertRejects(() => saveCommand(app, bad as never));
    await assertRejects(() => remove(app, provider), Error, "commands");
    await removeCommand(app, id);
    assertEquals(await commands(app), []);
    await remove(app, provider);
  } finally { await close(); }
});
