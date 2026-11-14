import { test } from "node:test";
import { App, fs, requestStorage, sql } from "@qino/qino";
import { entries } from "@qino/qino/calendar";
import { add } from "@qino/qino/cms.event";
import { cms as tree } from "@qino/qino/cms";
import { assertEquals, assertStringIncludes, assertThrows, testContext } from "@qino/qino/tests";

import { backendDashboardWidget, cms, install } from "../plugin.ts";

test("backend calendar reads CMS events through calendar, with node access and bounded dates", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms.event").add("cms.backend.calendar");
  await app.init();
  try {
    const ctx = await testContext({ app });
    ctx.app = app;
    await ctx.initSettings();
    await requestStorage.run(ctx, async () => {
      const root = await tree(app).node(1);
      const visible = await root.createChild({ access: 1, online_start: 0, online_end: 0 });
      const privateNode = await root.createChild({ access: 0, online_start: 0, online_end: 0 });
      await visible.title("en", "Course <b>one</b>");
      await add(visible, { start: "2027-07-12T09:00+02:00", end: "2027-07-12T11:00+02:00" });
      await add(visible, { start: "2027-07-13T15:00+02:00", end: "2027-07-14T09:00+02:00" });
      await add(visible, { start: "2027-07-14", end: "2027-07-15" });
      await add(privateNode, { start: "2027-07-12T09:00+02:00", end: "2027-07-12T11:00+02:00" });
      await add(visible, { start: "2027-07-20T09:00+02:00", end: "2027-07-20T11:00+02:00" });
      await add(visible, { start: "2027-07-21 09:00:00.001+02:00", end: "2027-07-21 09:00:00.003+02:00" });
      const period = { start: "2027-07-12", end: "2027-07-15", timeZone: "Europe/Zurich" };
      const result = await entries(ctx, period);
      assertEquals(result.length, 3);
      assertEquals(result.map((item) => item.source), ["cms.event", "cms.event", "cms.event"]);
      assertEquals(result[0].title, "Course one");
      assertEquals([result[0].start, result[0].end], ["2027-07-12T07:00:00.000000000Z", "2027-07-12T09:00:00.000000000Z"]);
      assertEquals([result[2].start, result[2].end], ["2027-07-14", "2027-07-15"]);
      assertEquals(result.every((item) => Boolean(item.url)), true);
      const stored = await app.db.row`SELECT ${sql.id("start")} AS value FROM cms_event WHERE node_id = ${visible.id} AND all_day = ${false} ORDER BY id LIMIT 1`;
      assertEquals(Number(stored!.value), Temporal.Instant.from("2027-07-12T07:00Z").epochMilliseconds);
      const wholeDay = await app.db.row`SELECT ${sql.id("start")} AS value FROM cms_event WHERE node_id = ${visible.id} AND all_day = ${true}`;
      assertEquals(Number(wholeDay!.value), Temporal.Instant.from("2027-07-14T00:00Z").epochMilliseconds);
      assertThrows(() => add(visible, { start: "2027-07-21T09:00:00.000000001Z", end: "2027-07-21T10:00Z" }), RangeError);
      const precise = await entries(ctx, { start: "2027-07-21T07:00:00.002000001Z", end: "2027-07-21T07:00:00.004Z", timeZone: "UTC" });
      assertEquals(precise.map((item) => item.start), ["2027-07-21T07:00:00.001000000Z"]);
      await add(visible, { start: "1969-12-31T23:59:59.999Z", end: "1970-01-01T00:00Z" });
      const beforeEpoch = await entries(ctx, { start: "1969-12-31T23:59:59.999999999Z", end: "1970-01-01T00:00:00.000000001Z", timeZone: "UTC" });
      assertEquals(beforeEpoch.length, 1);
      assertEquals(await entries(ctx, { start: "1970-01-01T00:00Z", end: "1970-01-01T00:00:00.000000001Z", timeZone: "UTC" }), []);

      await install({ app });
      const backend = (await tree(app).nodeByModule("cms.backend.calendar"))!;
      assertEquals(await cms.node.api(backend, period), result);
      const rendered = String(await cms.node.render(backend, { ctx }));
      assertStringIncludes(rendered, "<u2-calendar");
      assertStringIncludes(rendered, "role=status");
      assertStringIncludes(rendered, 'data-source-icon="cms.event"');
      assertStringIncludes(rendered, "pub/module.svg#main");

      const count = await app.db.one`SELECT COUNT(*) FROM cms_event`;
      assertEquals(await entries(ctx, { ...period, start: "2028-01-01", end: "2028-02-01" }), []);
      assertEquals(await app.db.one`SELECT COUNT(*) FROM cms_event`, count);

      const userId = Number(await app.db.table("usr").insert({ username: "calendar-user", superuser: true }));
      const user = await testContext({ app, userId, set: { app } });
      await user.initSettings();
      await requestStorage.run(user, async () => {
        const widget = String(await backendDashboardWidget(app, await backend.page()));
        assertStringIncludes(widget, `data-calendar-dashboard="${backend.id}"`);
        assertStringIncludes(widget, 'data-source-icon="cms.event"');
        assertEquals(await cms.node.api(backend, { ...period, sources: [], save: true }), []);
        const hidden = String(await backendDashboardWidget(app, await backend.page()));
        assertStringIncludes(hidden, 'data-sources="[]"');
        assertEquals(hidden.includes('data-source-icon="cms.event"'), false);
        await app.db.flush();
      });
      const returning = await testContext({ app, userId, set: { app } });
      await returning.initSettings();
      assertEquals((returning.settings["cms.backend.calendar"].sources() as Record<string, boolean>)["cms.event"], false);
      await requestStorage.run(returning, async () => assertEquals(await cms.node.api(backend, period), []));
      assertEquals(ctx.settings["cms.backend.calendar"].sources(), undefined);

      for (const date of ["2027-08-01", "2027-08-09", "2027-08-15"]) {
        await add(visible, { start: `${date}T09:00+02:00`, end: `${date}T11:00+02:00` });
        await add(privateNode, { start: `${date}T09:00+02:00`, end: `${date}T11:00+02:00` });
      }
      const blocks = await entries(ctx, { start: "2027-08-01", end: "2027-09-01", timeZone: "Europe/Zurich" });
      assertEquals(blocks.map((item) => item.start.slice(0, 10)), ["2027-08-01", "2027-08-09", "2027-08-15"]);
      assertEquals(new Set(blocks.map((item) => item.id)).size, 3);
    });
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
