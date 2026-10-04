import { App, requestStorage, toTools } from "@qino/qino";
import { assertEquals, assertRejects, testContext } from "@qino/qino/tests";
import { changed } from "@qino/qino/home";
import { history, providers } from "@qino/qino/home.history";

import { configure, capture, record, series } from "../mod.ts";
import { api, init } from "../plugin.ts";

const sample = { id: "counter", name: "Meter", state: 10, attributes: {}, available: true, unit: "kWh" };
const period = { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" };
const time = Date.parse(period.start);

async function fixture(live = false) {
  const dir = await Deno.makeTempDir(), app = new App({ dir, db: "sqlite::memory:" });
  for (const name of ["home", "home.history", "cron", "home.record"]) app.modules.add(new URL(`../../${name}/plugin.ts`, import.meta.url));
  if (live) {
    await Deno.writeTextFile(`${dir}/plugin.ts`, `
export const homeProvider = {
  name: "meter",
  entities: async (app) => [{ id: "counter", name: "Meter", state: await app.settings["test.provider"].value, attributes: {}, unit: "kWh", available: true }],
  history: async (_app, id, period) => [{ id, name: id, state: 123, attributes: {}, available: true, updated: period.start }],
};
`);
    app.modules.add(new URL(`file://${dir}/plugin.ts`), "test.provider");
  }
  await app.init();
  return { app, dir, close: async () => { await app.modules.unlink("home.record"); await app.modules.unlink("cron"); await app.db.close(); await Deno.remove(dir, { recursive: true }); } };
}

Deno.test("home recording is selected, typed, replaceable at one instant, stopped without losing history and tenant-local", async () => {
  const first = await fixture(), second = await fixture(), app = first.app;
  try {
    await record(app, "meter", sample, time);
    assertEquals(await app.db.one`SELECT COUNT(*) FROM home_sample`, 0);
    await configure(app, "meter", sample.id, true);
    await record(app, "meter", sample, time);
    await record(app, "meter", { ...sample, state: false, attributes: { sourceTime: "original" } }, time);
    await record(app, "meter", { ...sample, state: null, available: false }, time + 60_000);
    await record(app, "meter", { ...sample, state: 11 }, Date.parse(period.end));
    const data = await history(app, "meter", sample.id, period);
    assertEquals(data.map((row) => [row.state, row.available, row.unit]), [[false, true, "kWh"], [null, false, "kWh"]]);
    assertEquals(data[0].attributes, { sourceTime: "original" });
    assertEquals(data[0].updated, new Date(time).toISOString());
    assertEquals(await providers(app), ["meter"]);
    await assertRejects(() => history(app, "meter", sample.id, { ...period, limit: 1 }), Error, "exceeds");
    await assertRejects(() => history(app, "meter", sample.id, { ...period, source: "provider" }), Error, "not linked");
    await assertRejects(() => history(second.app, "meter", sample.id, { ...period, source: "local" }), Error, "not available");
    await configure(app, "meter", sample.id, false);
    await record(app, "meter", { ...sample, state: 999 }, time + 120_000);
    assertEquals((await history(app, "meter", sample.id, period)).length, 2);
    assertEquals((await series(app))[0].enabled, false);
    await assertRejects(() => record(app, "meter", sample, NaN), Error, "time");
    await assertRejects(() => configure(app, "", sample.id, true), Error, "identity");
  } finally { await first.close(); await second.close(); }
});

Deno.test("recording captures change events, periodic offline states and aborts its listeners", async () => {
  const { app, close } = await fixture();
  try {
    await configure(app, "offline", "counter", true);
    await changed(app, "offline", "counter", sample, null);
    const observed = await app.db.query<{ data: string }>`SELECT data FROM home_sample ORDER BY time`;
    assertEquals(JSON.parse(observed.at(-1)!.data).state, 10);
    await capture(app);
    const rows = await app.db.query<{ data: string }>`SELECT data FROM home_sample ORDER BY time`;
    assertEquals(JSON.parse(rows.at(-1)!.data).available, false);
    await app.modules.unlink("home.record");
    const count = await app.db.one`SELECT COUNT(*) FROM home_sample`;
    await changed(app, "offline", "counter", sample, null);
    assertEquals(await app.db.one`SELECT COUNT(*) FROM home_sample`, count);
    const signal = new AbortController();
    init(app, { signal: signal.signal });
    assertEquals((await history(app, "offline", "counter", { start: "2000-01-01T00:00:00Z", end: "2100-01-01T00:00:00Z", source: "local" })).length, count);
    signal.abort();
  } finally { await close(); }
});

Deno.test("recording tools enforce user access and boolean selection", async () => {
  const { app, close } = await fixture();
  try {
    const tools = toTools({ "home.record": api }), select = tools.find((tool) => tool.name.endsWith("entity_post"))!;
    const guest = await testContext({ app });
    await requestStorage.run(guest, () => assertRejects(() => select.execute({ provider: "x", entity: "y", enabled: true }, guest), Error, "Access denied"));
    const user = await testContext({ app, set: { user: { id: 7 } } });
    await requestStorage.run(user, async () => {
      await assertRejects(() => select.execute({ provider: "x", entity: "y", enabled: "false" }, user), Error, "Validation failed");
      await select.execute({ provider: "x", entity: "y", enabled: false }, user);
      assertEquals(await history(app, "x", "y", { ...period, source: "local" }), []);
    });
  } finally { await close(); }
});

Deno.test("local capture follows live provider states while explicit upstream history stays separate", async () => {
  const { app, close } = await fixture(true);
  const period = { start: "2000-01-01T00:00:00Z", end: "2100-01-01T00:00:00Z" };
  try {
    await app.settings["test.provider"].value(7);
    await configure(app, "meter", "counter", true);
    assertEquals((await history(app, "meter", "counter", period)).at(-1)!.state, 7);
    assertEquals((await history(app, "meter", "counter", { ...period, source: "provider" }))[0].state, 123);
    await app.settings["test.provider"].value(9);
    await capture(app);
    assertEquals((await history(app, "meter", "counter", period)).at(-1)!.state, 9);
    await app.modules.unlink("test.provider");
    await capture(app);
    assertEquals((await history(app, "meter", "counter", period)).at(-1)!.available, false);
    assertEquals(await providers(app), ["meter"]);
  } finally { await close(); }
});
