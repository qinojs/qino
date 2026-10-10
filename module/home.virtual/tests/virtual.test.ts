import { App } from "@qino/qino";
import { assertEquals, assertRejects } from "@qino/qino/tests";
import { reported, commands, entities, save, saveCommand } from "@qino/qino/home";

import { apply, homeProvider, saveVirtual, virtuals } from "../mod.ts";

// The source adapter carries the template's adapter name, so the Android template applies to it.
async function fixture() {
  const dir = await Deno.makeTempDir({ prefix: "qino-home-virtual-test-" }), app = new App({ dir, db: "sqlite::memory:" });
  await Deno.writeTextFile(`${dir}/plugin.ts`, `
export const calls = [];
export const homeProvider = {
  name: "homeassistant",
  entities: async () => [{ id: "sensor.phone_screen_brightness", name: "Brightness", state: "153", attributes: {}, available: true }],
  actions: async () => [],
  call: async (_app, _id, action, input) => { calls.push({ action, input }); return { ok: true }; },
};
`);
  app.modules.add(new URL("../../home/plugin.ts", import.meta.url));
  app.modules.add(new URL("../plugin.ts", import.meta.url));
  app.modules.add(new URL(`file://${dir}/plugin.ts`), "fake.adapter");
  await app.init();
  const fake = await import(`file://${dir}/plugin.ts`);
  const source = await save(app, { name: "House", adapter: "homeassistant" });
  const provider = await save(app, { name: "Virtual", adapter: "virtual" });
  return {
    app, source, provider, calls: fake.calls as unknown[],
    close: async () => { await app.db.close(); await Deno.remove(dir, { recursive: true }); },
  };
}

Deno.test("virtual entities read their source, set through their command and validate the value", async () => {
  const { app, source, provider, calls, close } = await fixture();
  try {
    const order = await saveCommand(app, {
      provider: source, name: "Brightness", action: "notify.mobile_app_phone",
      data: { message: "command_screen_brightness_level" }, parameter: "data.command",
    });
    const id = await saveVirtual(app, {
      provider, name: "Phone brightness", source_provider: source, source_entity: "sensor.phone_screen_brightness",
      command: order, value: { type: "integer", minimum: 0, maximum: 255 },
    });
    assertEquals((await entities(app, provider))[0], {
      id: String(id), name: "Phone brightness", state: "153", attributes: {}, available: true, provider,
    });
    const [action] = await homeProvider.actions(app, provider);
    assertEquals(action, {
      id: `set.${id}`, name: "Phone brightness", targets: [String(id)],
      input: { type: "object", properties: { value: { type: "integer", minimum: 0, maximum: 255 } }, required: ["value"] },
    });
    await homeProvider.call(app, provider, `set.${id}`, { data: { value: 80 } });
    assertEquals(calls, [{
      action: "notify.mobile_app_phone", input: { data: { message: "command_screen_brightness_level", data: { command: 80 } } },
    }]);
    for (const value of [256, "80", undefined]) {
      await assertRejects(() => homeProvider.call(app, provider, `set.${id}`, { data: { value } }), Error, "Invalid value");
    }
    await assertRejects(() => homeProvider.call(app, source, `set.${id}`, { data: { value: 1 } }), Error, "not found");
    // Sources are real entities; a virtual source could form a cycle.
    await assertRejects(() => saveVirtual(app, { provider, name: "Loop", source_provider: provider, source_entity: String(id) }));
    await assertRejects(() => saveVirtual(app, { provider: source, name: "Not virtual" }), Error, "virtual provider");
  } finally { await close(); }
});

Deno.test("virtual entities pass on their source's observations and changes", async () => {
  const { app, source, provider, close } = await fixture();
  try {
    const id = await saveVirtual(app, { provider, name: "Mirror", source_provider: source, source_entity: "sensor.x" });
    const seen: unknown[] = [];
    app.on("home:change", (event) => { if (event.provider === provider) seen.push(event); });
    let observations = 0;
    app.on("home:observe", (event) => { if (event.provider === provider) observations++; });
    const entity = { id: "sensor.x", name: "X", state: "on", attributes: {}, available: true };
    await reported(app, source, "sensor.x", entity, null);
    const mirrored = { ...entity, id: String(id), name: "Mirror" };
    assertEquals(seen, [{ provider, id: String(id), entity: mirrored, previous: null, changed: [""] }]);
    let inputs = 0;
    app.on("home:input", (event) => { if (event.provider === provider) inputs++; });
    await reported(app, source, "sensor.x", entity, entity); // reported again, unchanged: input only
    assertEquals([seen.length, inputs], [1, 1]);
    assertEquals(observations, 2);
    await reported(app, source, "sensor.other", entity, null);
    assertEquals(seen.length, 1);
  } finally { await close(); }
});

Deno.test("the Android template creates a device's commands and virtual entities once", async () => {
  const { app, source, provider, close } = await fixture();
  try {
    const ids = await apply(app, "android", { provider, source, device: "phone" });
    const created = await virtuals(app, provider);
    assertEquals(created.length, ids.length);
    const brightness = created.find((row) => row.name === "phone Screen brightness")!;
    assertEquals(brightness.source_entity, "sensor.phone_screen_brightness");
    const order = (await commands(app)).find((row) => row.id === brightness.command)!;
    assertEquals([order.action, order.parameter], ["notify.mobile_app_phone", "data.command"]);
    assertEquals(await apply(app, "android", { provider, source, device: "phone" }), []);
    await assertRejects(() => apply(app, "android", { provider, source, device: "Bad Name" }), Error, "device name");
    await assertRejects(() => apply(app, "android", { provider, source: provider, device: "phone" }), Error, "homeassistant");
  } finally { await close(); }
});
