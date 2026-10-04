import { App, requestStorage, toTools } from "@qino/qino";
import { assertEquals, assertRejects, testContext } from "@qino/qino/tests";

import { actions, call, changed, entities, provider, providers, remove, save } from "../mod.ts";
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
const input = { name: "First", adapter: "fake", url: "https://first.test/", config: { token: "private", nested: { password: "nested-private", label: "Public" } } };

Deno.test("home persists distinct provider instances and dispatches overlapping entity identities by numeric ID", async () => {
  const { app, close } = await fixture();
  try {
    const first = await save(app, input), second = await save(app, { ...input, name: "Second", url: "https://second.test/" });
    assertEquals([first, second], [1, 2]);
    assertEquals((await providers(app)).map((row) => [row.id, row.adapter, row.url]), [[1, "fake", input.url], [2, "fake", "https://second.test/"]]);
    assertEquals((await entities(app)).map((row) => [row.id, row.provider, row.state]), [["same", 1, 1], ["same", 2, 2]]);
    assertEquals((await actions(app, second))[0].provider, second);
    assertEquals(await call(app, second, "set", { data: { value: false } }), { provider: 2, action: "set", input: { data: { value: false } } });
    await save(app, { ...input, id: first, enabled: false });
    await assertRejects(() => entities(app, first), Error, "disabled");
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
    assertEquals((await provider(app, id)).config, { token: "private", nested: { password: "nested-private", label: "Changed" } });
    assertEquals(JSON.stringify(events).includes("private"), false);
    await assertRejects(() => save(app, { ...input, id, config: { unknown: true } }), Error, "configuration");
    assertEquals((await provider(app, id)).config.nested, { password: "nested-private", label: "Changed" });
    await assertRejects(() => save(app, { ...input, adapter: "absent" }), Error, "not linked");
  } finally { await close(); }
});

Deno.test("home tools redact credentials, enforce user access and dispatch validated provider IDs", async () => {
  const { app, close } = await fixture();
  try {
    const id = await save(app, { ...input, config: { ...input.config, accounts: [{ token: "array-private", label: "Public account" }] } }), tools = toTools({ home: api });
    const list = tools.find((tool) => tool.name === "home_providers_get")!;
    const action = tools.find((tool) => tool.name === "home_provider_action_post")!;
    const ctx = await testContext({ app, set: { user: { id: 7 } } });
    await requestStorage.run(ctx, async () => {
      const rows = await list.execute({}, ctx) as { config: unknown }[];
      assertEquals(rows[0].config, { nested: { label: "Public" }, accounts: [{ label: "Public account" }] });
      assertEquals(await action.execute({ provider: id, action: "set", data: { value: false } }, ctx), { provider: id, action: "set", input: { data: { value: false }, entities: undefined } });
      await assertRejects(() => action.execute({ provider: id, action: "set", entities: "bad" }, ctx), Error, "Validation failed");
    });
    const guest = await testContext({ app });
    await requestStorage.run(guest, () => assertRejects(() => list.execute({}, guest), Error, "Access denied"));
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
