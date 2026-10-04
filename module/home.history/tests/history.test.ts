import { App, requestStorage, toTools } from "@qino/qino";
import { assertEquals, assertRejects, testContext } from "@qino/qino/tests";
import { configure, save } from "@qino/qino/home";

import { history } from "../mod.ts";
import { api } from "../plugin.ts";

const period = { start: "2026-10-03T02:00:00+02:00", end: "2026-10-04T02:00:00+02:00", source: "provider" as const };

Deno.test("home history resolves persisted datapoints, validates periods and protects upstream access", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qino-home-history-test-" }), app = new App({ dir, db: "sqlite::memory:" });
  await Deno.writeTextFile(`${dir}/plugin.ts`, `export const homeProvider = {
    name: "archive", entities: async () => [], actions: async () => [], call: async () => null,
    history: async (_app, _id, entity, period) => [{ id: entity, name: entity, state: 0, available: true, attributes: {}, updated: period.start }],
  };`);
  for (const name of ["home", "home.history"]) app.modules.add(new URL(`../../${name}/plugin.ts`, import.meta.url));
  app.modules.add(new URL(`file://${dir}/plugin.ts`), "fake.adapter");
  try {
    await app.init();
    const provider = await save(app, { name: "Archive", adapter: "archive", url: "" }), id = await configure(app, { provider, entity: "same" });
    assertEquals((await history(app, id, period)).samples, [{ time: Date.parse(period.start), value: 0 }]);
    await assertRejects(() => history(app, id, { ...period, end: period.start }), Error, "precede");
    await assertRejects(() => history(app, id, { ...period, start: "2026-10-03T00:00:00" }), Error, "timezone");
    await assertRejects(() => history(app, id, { ...period, width: 0 }), Error, "width");
    await assertRejects(() => history(app, id, { ...period, maxGap: -1 }), Error, "gap");
    const read = toTools({ "home.history": api })[0], user = await testContext({ app, set: { app, user: { id: 7 } } });
    await requestStorage.run(user, async () => {
      assertEquals(((await read.execute({ datapoint: id, ...period }, user)) as { samples: unknown[] }).samples.length, 1);
      await assertRejects(() => read.execute({ datapoint: id }, user), Error, "Validation failed");
    });
    const guest = await testContext({ app, set: { app } });
    await requestStorage.run(guest, () => assertRejects(() => read.execute({ datapoint: id, ...period }, guest), Error, "Access denied"));
  } finally { await app.db.close(); await Deno.remove(dir, { recursive: true }); }
});
