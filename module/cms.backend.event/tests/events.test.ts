import { test } from "node:test";
import { AccessError, App, fs, Output, requestStorage } from "@qino/qino";
import { cms as tree } from "@qino/qino/cms";
import { entries } from "@qino/qino/calendar";
import { add, get } from "@qino/qino/cms.event";
import { assertEquals, assertRejects, assertStringIncludes, testContext } from "@qino/qino/tests";

import api from "../nodeApi.ts";
import render from "../render.ts";
import { backendEdit, install } from "../plugin.ts";

test("event management uses CMS categories, checks both permission levels and paginates", async () => {
  const dir = await fs.tempDir() + "/", app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms.backend.event");
  await app.init();
  app.languages.setLangs(["en", "de", "fr"]);
  const categoryPlugin = app.modules.get("cms.cont.event.category")!.plugin.cms;
  const context = async (userId = 0, url = "http://qino.test/") => {
    const ctx = await testContext({ app, userId, url, set: { app } });
    await ctx.initSettings();
    return ctx;
  };
  try {
    const user = async (username: string, superuser = false) => Number(await app.db.table("usr").insert({ username, superuser, pw: "", given_name: username, family_name: "Test" }));
    const admin = await context(await user("event-admin", true)), editorId = await user("event-editor"), readerId = await user("event-reader");
    const root = await tree(app).node(1);
    const { panel, page, category, hidden } = await requestStorage.run(admin, async () => {
      await install({ app });
      const panel = (await tree(app).nodeByModule("cms.backend.event"))!;
      await panel.changeUser(editorId, 2);
      await panel.changeUser(readerId, 1);
      const page = await root.createChild({ module: "cms.layout.standard.1", access: 1, online_start: 0, online_end: 0 });
      await page.title("en", "Event venue");
      await page.changeUser(editorId, 2);
      const container = await page.cont("main", "cms.cont.flexible");
      const category = await container.createCont({ module: "cms.cont.event.category" });
      await category.title("en", "Workshops");
      const hidden = await container.createCont({ module: "cms.cont.event.category" });
      await hidden.title("en", "Private category");
      await hidden.set("access", 0);
      await hidden.changeUser(editorId, 0);
      return { panel, page, category, hidden };
    });
    const editor = await context(editorId);
    const event = await requestStorage.run(editor, async () => {
      const result = await api(panel, { create: { parent: category.id, title: "Pottery" } }) as { id: number };
      const event = await tree(app).node(result.id);
      assertEquals(event.vs.basis, category.id);
      assertEquals(event.vs.access, 0);
      assertEquals(await event.access(), 3);
      await add(event, { start: "2027-07-12", end: "2027-07-13" });
      await assertRejects(() => api(panel, { move: { event: event.id, category: hidden.id } }), AccessError);
      const denied = new AbortController();
      tree(app).on("module:access", (event) => { event.access = 0; }, { signal: denied.signal });
      try { await assertRejects(() => api(panel, { create: { parent: category.id, title: "Module denied" } }), AccessError); }
      finally { denied.abort(); }
      return event;
    });
    const period = { start: "2027-07-01", end: "2027-08-01", timeZone: "UTC" };
    const detailContext = await context(editorId, `http://qino.test/?id=${event.id}`);
    await requestStorage.run(detailContext, async () => {
      const html = String(await render(panel, { ctx: detailContext }));
      assertStringIncludes(html, "data-event-texts");
      assertStringIncludes(html, `data-event-widget="${event.id}"`);
      await api(panel, { texts: { id: event.id, lang: app.languages.def, title: "Pottery", location: "Workshop hall", main: "<p>Learn pottery</p>" } });
      assertEquals((await event.showText("main", app.languages.def)).plain(), "Learn pottery");
      await api(panel, { texts: { id: event.id, lang: "de", title: "Töpferkurs", location: "Atelier", main: "<p>Töpfern lernen</p>" } });
      assertEquals(await event.title("en"), "Pottery");
      assertEquals(await event.title("de"), "Töpferkurs");
      assertEquals((await event.showText("main", "en")).plain(), "Learn pottery");
      await assertRejects(() => api(panel, { texts: { id: event.id, lang: "invalid", title: "Wrong", location: "", main: "" } }));
      await event.set("online_end", 1);
      assertEquals((await app.modules.get("cms.cont.event")!.plugin.cms.node.api(event, { get: true })).dates.length, 1);
      await event.set("online_end", 0);
    });
    await requestStorage.run(await context(), async () => {
      assertEquals(await entries((await context()), period), []);
      const rendered = String(await categoryPlugin.node.render(category, { ctx: await context() }));
      assertEquals(rendered.includes("Pottery"), false);
    });
    await requestStorage.run(await context(editorId), () => event.set("access", null));
    await requestStorage.run(await context(), async () => {
      assertEquals((await entries(await context(), period)).length, 1);
      const html = String(await categoryPlugin.node.render(category, { ctx: await context() }));
      assertStringIncludes(html, "Pottery");
      assertStringIncludes(html, 'datetime="2027-07-12"');
      assertStringIncludes(html, `?cms_event_ics=${category.id}`);
    });
    // the category as a feed: its readable events, upcoming dates only
    const feed = await context(0, `http://qino.test/?cms_event_ics=${category.id}`);
    await requestStorage.run(feed, async () => {
      const out = await categoryPlugin.node.render(category, { ctx: feed }).then(() => undefined, (e: Output) => e);
      assertEquals(out instanceof Output, true);
      assertStringIncludes(String(out?.body), "SUMMARY:Pottery\r\n");
      assertStringIncludes(String(out?.body), "DTSTART;VALUE=DATE:20270712\r\n");
    });
    await requestStorage.run(await context(readerId), async () => {
      const rendered = String(await render(panel, { ctx: await context(readerId) }));
      assertStringIncludes(rendered, "Pottery");
      assertEquals(rendered.includes("Private category"), false);
      assertEquals(rendered.includes("data-event-visibility"), false);
      const ctx = await context(readerId, `http://qino.test/?id=${event.id}`);
      const detail = String(await render(panel, { ctx }));
      assertEquals(detail.includes("data-event-widget"), false);
      assertStringIncludes(detail, "disabled");
      await assertRejects(() => api(panel, { texts: { id: event.id, lang: app.languages.def, title: "Denied", location: "", main: "" } }), AccessError);
    });
    await requestStorage.run(await context(editorId), async () => {
      await assertRejects(() => api(panel, { create: { parent: hidden.id, title: "Denied" } }), AccessError);
      await assertRejects(() => api(panel, { move: { event: page.id, category: category.id } }));
      await event.set("access", 0);
      await assertRejects(() => api(panel, { create: { parent: page.id, title: "Wrong target" } }));
    });
    await requestStorage.run(admin, async () => {
      await api(panel, { move: { event: event.id, category: hidden.id } });
      await event.set("access", null);
    });
    await requestStorage.run(await context(), async () => {
      assertEquals(await entries(await context(), period), []);
    });
    // what is an event is the row, whatever module shows it: a course sold as a product, say
    await requestStorage.run(admin, async () => {
      const course = await page.cont("main", "cms.cont.text");
      await course.title("en", "Course as content");
      assertEquals(await backendEdit(course), undefined);
      await assertRejects(() => api(panel, { event: { id: course.id, get: true } }));
      await add(course, { start: "2027-07-20", end: "2027-07-21" }); // a date makes it one
      assertEquals(await backendEdit(course), "Edit event in the backend");
      // in the calendar an editor opens it in the backend, a visitor sees no edit link
      const july = { start: "2027-07-20", end: "2027-07-21", timeZone: "UTC" };
      const own = (await entries(admin, july)).find((item) => item.title === "Course as content");
      assertStringIncludes(own?.editUrl ?? "", `id=${course.id}`);
      const guest = await context();
      assertEquals(await requestStorage.run(guest, async () => (await entries(guest, july)).some((item) => item.editUrl)), false);
      await api(panel, { event: { id: course.id, set: { address_locality: "Basel" } } });
      assertEquals((await get(course))?.address_locality, "Basel");
      assertStringIncludes(String(await render(panel, { ctx: admin })), "Course as content");
      const ctx = await context(await app.db.one`SELECT id FROM usr WHERE username = ${"event-admin"}`.then(Number), `http://qino.test/?id=${course.id}`);
      const detail = String(await render(panel, { ctx }));
      // the same detail as any event's: location too, the category is its parent's title
      assertStringIncludes(detail, `data-event-widget="${course.id}" data-widget-src="${app.modules.get("cms.cont.event")!.modUrl}pub/widget.js"`);
      assertStringIncludes(detail, "name=location");
      assertEquals(detail.includes("data-event-move"), false);
      await api(panel, { texts: { id: course.id, lang: "en", title: "Course renamed", location: "Hall", main: "<p>About</p>" } });
      assertEquals(await course.title("en"), "Course renamed");
    });
    await requestStorage.run(admin, async () => {
      const second = await category.parent();
      const next = await second!.createCont({ module: "cms.cont.event.category" });
      await api(panel, { move: { event: event.id, category: next.id } });
      assertEquals(Number(event.vs.basis), next.id);
      const title = category.vs.title_id;
      for (let i = 0; i < 51; i++) {
        const id = await app.db.table("page").insert({ basis: category.id, module: "cms.cont.event", type: "c", title_id: title, access: 1, online_start: 0, online_end: 0, sort: i });
        if (i % 2) await add(await tree(app).node(Number(id)), { start: `2027-08-${String(i % 28 + 1).padStart(2, "0")}`, end: "2027-09-01" });
      }
      // a past event is no longer listed publicly
      await add(await tree(app).node(Number(await app.db.one`SELECT id FROM page WHERE basis = ${category.id} AND sort = ${0}`)), { start: "2020-01-01", end: "2020-01-02" });
      const html = String(await render(panel, { ctx: admin }));
      assertEquals(html.split("<th scope=row>").length - 1, 50);
      assertStringIncludes(html, "page=2");
      assertStringIncludes(html, 'datetime="2027-07-12"');
      assertStringIncludes(html, `id=${event.id}`);
      assertStringIncludes(html, "<tr u2-href>");
      assertEquals(html.includes("data-event-visibility"), false);
      assertEquals(html.includes("name=schedule"), false);
      assertEquals(html.includes("view=categories"), false);
      const publicList = String(await categoryPlugin.node.render(category, { ctx: admin }));
      assertEquals(publicList.split("<li><article>").length - 1, 20);
      assertStringIncludes(publicList, `cms_event_${category.id}_page=2`);
      // the next date first
      const dates = [...publicList.matchAll(/<time datetime="([^"]+)"/g)].map((m) => m[1]);
      assertEquals(dates, [...dates].sort());
      assertEquals(dates.includes("2020-01-01"), false);
    });
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
