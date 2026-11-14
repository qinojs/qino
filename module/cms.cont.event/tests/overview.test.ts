import { test } from "node:test";
import { App, fs, requestStorage, sql } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { add } from "@qino/qino/cms.event";
import { assertEquals, assertStringIncludes, testContext } from "@qino/qino/tests";

import { formatDates, overview } from "../mod.ts";

test("event previews keep nodes paginated and dates bounded in one SQL query", async () => {
  const dir = await fs.tempDir() + "/", app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms.cont.event");
  await app.init();
  try {
    const ctx = await testContext({ app, set: { app } });
    await ctx.initSettings();
    await requestStorage.run(ctx, async () => {
      const root = await cms(app).node(1);
      const first = await root.createCont({ module: "cms.cont.event", access: 1 });
      const second = await root.createCont({ module: "cms.cont.event", access: 1 });
      await add(first, { start: "2026-11-17", end: "2026-11-19" });
      for (const day of [12, 13, 14, 15]) await add(first, { start: `2027-07-${day}T09:00+02:00`, end: `2027-07-${day}T11:00+02:00` });
      let queries = 0;
      const db = { query: (...args: Parameters<typeof app.db.query>) => { queries++; return app.db.query(...args); } } as typeof app.db;
      const items = await overview(db, sql`SELECT * FROM page WHERE ${sql.in("id", [first.id, second.id])} ORDER BY id LIMIT ${2}`, sql`p.id`);
      assertEquals(queries, 1);
      assertEquals(items.length, 2);
      assertEquals(items[0].count, 5);
      assertEquals(items[0].period, { start: "2026-11-17", end: "2027-07-15T09:00:00Z" });
      const period = String(formatDates([items[0].period!], "de", "Europe/Zurich")[0]);
      assertStringIncludes(period, "17. November 2026");
      assertStringIncludes(period, "15. Juli 2027");
      assertStringIncludes(period, "11:00");
      assertEquals(items[0].blocks.length, 3);
      assertEquals(items[1].count, 0);
      assertEquals(items[1].blocks, []);
      assertEquals(items[0].blocks[0], { start: "2026-11-17", end: "2026-11-19" });
      const dates = formatDates(items[0].blocks, "de", "Europe/Zurich").map(String);
      assertStringIncludes(dates[0], "17.–18. November 2026");
      assertStringIncludes(dates[1], "09:00");
      assertStringIncludes(dates[1], "11:00");
      assertEquals(dates[0].includes("Ganztägig"), false);
      assertStringIncludes(String(formatDates([items[0].blocks[0]], "de", "America/Los_Angeles")[0]), "17.–18. November 2026");
      const one = await overview(app.db, sql`SELECT * FROM page WHERE ${sql.in("id", [first.id, second.id])} ORDER BY id LIMIT ${1} OFFSET ${1}`, sql`p.id`);
      assertEquals(one.map((item) => Number(item.row.id)), [second.id]);
    });
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
