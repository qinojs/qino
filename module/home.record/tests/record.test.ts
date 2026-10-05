import { App, requestStorage, toTools } from "@qino/qino";
import { assertEquals, assertRejects, testContext } from "@qino/qino/tests";
import { changed, observed, configure, datapoint, save, value } from "@qino/qino/home";
import { history } from "@qino/qino/home.history";

import { record } from "../mod.ts";
import { api, cron } from "../plugin.ts";

import type { Adapter } from "@qino/qino/home";

const start = Date.parse("2026-01-01T00:00:00Z");
const period = { start: new Date(start).toISOString(), end: new Date(start + 3600_000).toISOString(), source: "local" as const };

async function fixture() {
  const dir = await Deno.makeTempDir({ prefix: "qino-home-record-test-" }), app = new App({ dir, db: "sqlite::memory:" });
  await Deno.writeTextFile(`${dir}/plugin.ts`, `
export const homeProvider = {
  name: "fake", schema: { type: "object", properties: { url: { type: "string" } } },
  entities: async () => [], actions: async () => [], call: async () => null,
  history: async (_app, _provider, id, period) => [{ id, name: id, state: 73, unit: "°C", attributes: {}, available: true, updated: period.start }],
};
`);
  for (const name of ["home", "home.history", "cron", "home.record"]) app.modules.add(new URL(`../../${name}/plugin.ts`, import.meta.url));
  app.modules.add(new URL(`file://${dir}/plugin.ts`), "fake.adapter");
  await app.init();
  const provider = await save(app, { name: "First", adapter: "fake", config: { url: "http://first.test/" } });
  return { app, provider, close: async () => { app.modules.unlink("home.record"); app.modules.unlink("cron"); await app.db.close(); await Deno.remove(dir, { recursive: true }); } };
}

Deno.test("measurement rows contain numeric datapoint/time/value only, replace repeated instants and retain millisecond precision", async () => {
  const { app, provider, close } = await fixture();
  try {
    const id = await configure(app, { provider, entity: "temperature", unit: "°C", record: true });
    await record(app, id, 21, start);
    await record(app, id, 22, start);
    await record(app, id, 23, start + 1);
    await record(app, id, null, start + 2);
    const result = await history(app, id, period);
    assertEquals(result.samples, [{ time: start, value: 22 }, { time: start + 1, value: 23 }, { time: start + 2, value: null }]);
    assertEquals((await app.db.columns("home_number")).map((field) => field.Field), ["datapoint", "time", "value"]);
    await assertRejects(() => record(app, id, 1, NaN), Error, "time");
    await assertRejects(() => record(app, id, Infinity, start), Error, "datatype");
  } finally { await close(); }
});

Deno.test("numeric and discrete datapoints have different typed storage and immutable interpretations", async () => {
  const { app, provider, close } = await fixture();
  try {
    const id = await configure(app, { provider, entity: "switch", type: "state", mapping: { on: 1, off: 0 }, record: true });
    const point = await datapoint(app, id);
    const entity = { id: "switch", name: "Switch", state: "off", available: true, attributes: {} };
    assertEquals(value(point, entity), 0);
    assertEquals(value(point, { ...entity, state: false }), 0);
    assertEquals(value(point, { ...entity, state: "unknown" }), null);
    assertEquals(value(point, { ...entity, state: "on", unit: "unexpected" }), null);
    await record(app, id, 0, start);
    assertEquals(await app.db.one`SELECT value FROM home_state WHERE datapoint = ${id} AND time = ${start}`, 0);
    await assertRejects(() => record(app, id, 0.5, start), Error, "datatype");
    await assertRejects(() => record(app, id, 128, start), Error, "datatype");
    // The same interpretation reuses the datapoint; editing by ID changes only its metadata.
    assertEquals(await configure(app, { provider, entity: "switch", type: "state", mapping: { off: 0, on: 1 }, name: "Renamed" }), id);
    assertEquals((await datapoint(app, id)).name, "Renamed");
    const gauge = await configure(app, { provider, entity: "gauge" });
    assertEquals(value(await datapoint(app, gauge), { ...entity, state: false }), null);
  } finally { await close(); }
});

Deno.test("late measurements do not rewrite latest state; stopping preserves archives and upstream selection is explicit", async () => {
  const { app, provider, close } = await fixture();
  try {
    const id = await configure(app, { provider, entity: "temperature", unit: "°C", record: true });
    await record(app, id, 4, start);
    await record(app, id, 2, start - 1);
    const current = Date.now() + 1;
    await record(app, id, 6, current);
    await record(app, id, 1, current - 1);
    const before = await datapoint(app, id);
    // Older observations remain in the archive without rewriting the current state.
    assertEquals(before.value, 6);
    assertEquals(before.time, current);
    await configure(app, { id, record: false });
    await assertRejects(() => record(app, id, 999, start + 10), Error, "Enable recording");
    assertEquals((await history(app, id, period)).samples, [{ time: start, value: 4 }]);
    assertEquals((await history(app, id, { ...period, source: "provider" })).samples, [{ time: start, value: 73 }]);
    await assertRejects(() => history(app, id, { ...period, limit: 0 }), Error, "positive");
    await assertRejects(() => history(app, id, { ...period, end: period.start }), Error, "precede");
    await assertRejects(() => history(app, id, { ...period, start: "bad" }), Error, "timezone");
  } finally { await close(); }
});

Deno.test("recording follows source observations, records gaps and removes listeners on module unlink", async () => {
  const { app, provider, close } = await fixture();
  try {
    const id = await configure(app, { provider, entity: "temperature", unit: "°C", record: true });
    const entity = { id: "temperature", name: "Temperature", unit: "°C", state: 5, attributes: {}, available: true, updated: new Date(start).toISOString() };
    let changes = 0;
    app.on("home:change", () => { changes++; });
    await observed(app, provider, entity.id, entity, start);
    assertEquals(changes, 0);
    await changed(app, provider, entity.id, entity, null);
    await changed(app, provider, entity.id, { ...entity, available: false, updated: new Date(start + 1).toISOString() }, entity);
    assertEquals((await history(app, id, period)).samples, [{ time: start, value: 5 }, { time: start + 1, value: null }]);
    app.modules.unlink("home.record");
    const count = await app.db.one`SELECT COUNT(*) FROM home_number`;
    await changed(app, provider, entity.id, { ...entity, updated: new Date(start + 2).toISOString() }, entity);
    assertEquals(await app.db.one`SELECT COUNT(*) FROM home_number`, count);
  } finally { await close(); }
});

Deno.test("recording tools enforce user access; stale detection writes one gap instead of periodic copies", async () => {
  const { app, provider, close } = await fixture();
  try {
    const id = await configure(app, { provider, entity: "temperature", unit: "°C", interval: 30, record: true });
    const tool = toTools({ "home.record": api })[0], user = await testContext({ app, set: { app, user: { id: 7, superuser: true } } });
    await requestStorage.run(user, () => tool.execute({ datapoint: id, time: Date.now(), value: 2 }, user));
    await app.db.query`UPDATE home_datapoint SET time = ${Date.now() - 120_000} WHERE id = ${id}`;
    await cron.stale.run(app);
    const count = await app.db.one`SELECT COUNT(*) FROM home_number`;
    await cron.stale.run(app);
    assertEquals(await app.db.one`SELECT COUNT(*) FROM home_number`, count);
    assertEquals((await datapoint(app, id)).value, null);
    const guest = await testContext({ app, set: { app } });
    await requestStorage.run(guest, () => assertRejects(() => tool.execute({ datapoint: id, time: start, value: 9 }, guest), Error, "Access denied"));
  } finally { await close(); }
});

Deno.test("unchanged values are stored once per expected interval", async () => {
  const { app, provider, close } = await fixture();
  try {
    const steady = await configure(app, { provider, entity: "steady", record: true });
    const beating = await configure(app, { provider, entity: "beating", interval: 10, record: true });
    for (const id of [steady, beating]) {
      const values: [number, number | null][] = [[0, 1], [1000, 1], [9000, 1], [11000, 1], [12000, 2], [13000, null], [14000, null], [15000, 2]];
      for (const [offset, value] of values) await record(app, id, value, start + offset);
    }
    const times = async (id: number) => (await history(app, id, period)).samples.map((sample) => sample.time - start);
    assertEquals(await times(steady), [0, 12000, 13000, 15000]);
    // The heartbeat keeps steady streams alive for gap and stale detection.
    assertEquals(await times(beating), [0, 11000, 12000, 13000, 15000]);
    assertEquals((await datapoint(app, steady)).time, start + 15000);
  } finally { await close(); }
});

Deno.test("bounded history aggregates gauges and counter differences before reducing output", async () => {
  const { app, provider, close } = await fixture();
  try {
    const id = await configure(app, { provider, entity: "meter", record: true });
    for (let i = 0; i < 100; i++) await record(app, id, i, start + i * 1000);
    const span = { ...period, end: new Date(start + 100_000).toISOString(), width: 10 };
    const result = await history(app, id, span);
    assertEquals(result.samples.length, 10);
    assertEquals(result.samples[0], { time: start, value: 4.5, min: 0, max: 9, count: 10, gap: true });
    assertEquals((await history(app, id, { ...span, consumption: true })).samples.reduce((sum, sample) => sum + (sample.value ?? 0), 0), 99);
    await record(app, id, 0, start + 50_000);
    const reset = await history(app, id, { ...period, end: new Date(start + 53_000).toISOString(), consumption: true });
    assertEquals(reset.samples[50].value, null);
    assertEquals(reset.samples[50].gap, true);
    assertEquals(reset.samples[51].value, 51);
    await assertRejects(() => history(app, id, { ...period, limit: 10 }), Error, "sample limit");
    const state = await configure(app, { provider, entity: "switch", type: "state", record: true });
    await record(app, state, 0, start); await record(app, state, 1, start + 1);
    assertEquals((await history(app, state, { ...period, width: 1 })).samples[0].value, 1);
    await assertRejects(() => history(app, state, { ...period, consumption: true }), Error, "numeric counter");
  } finally { await close(); }
});

Deno.test("starting the recorder after a ready provider captures a snapshot without change rules", async () => {
  const { app, provider, close } = await fixture();
  try {
    const id = await configure(app, { provider, entity: "temperature", unit: "°C", record: true });
    app.modules.unlink("home.record");
    const adapter = app.modules.linked("fake.adapter")!.plugin.homeProvider as Adapter;
    adapter.entities = async () => [{ id: "temperature", name: "Temperature", unit: "°C", state: 12, attributes: {}, available: true }];
    let changes = 0;
    app.on("home:change", () => { changes++; });
    await app.modules.link("home.record");
    for (let i = 0; i < 100 && (await datapoint(app, id)).value !== 12; i++) await new Promise((resolve) => setTimeout(resolve, 1));
    assertEquals((await datapoint(app, id)).value, 12);
    assertEquals(changes, 0);
  } finally { await close(); }
});
