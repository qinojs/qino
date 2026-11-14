import { test } from "node:test";
import { AccessError, App, fs, requestStorage } from "@qino/qino";
import { cms as tree } from "@qino/qino/cms";
import { entries } from "@qino/qino/calendar";
import { add } from "@qino/qino/cms.event";
import { assertEquals, assertRejects, assertStringIncludes, testContext } from "@qino/qino/tests";

import api from "../nodeApi.ts";
import render from "../render.ts";
import { install } from "../plugin.ts";

test("event management uses CMS categories, checks both permission levels and paginates", async () => {
  const dir = await fs.tempDir() + "/", app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms.backend.event");
  await app.init();
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
    const { panel, page, category, hidden, shared } = await requestStorage.run(admin, async () => {
      await install({ app });
      const panel = (await tree(app).nodeByModule("cms.backend.event"))!;
      await panel.changeUser(editorId, 2);
      await panel.changeUser(readerId, 1);
      const page = await root.createChild({ module: "cms.layout.standard.1", access: 1, online_start: 0, online_end: 0 });
      await page.title("en", "Event venue");
      await page.changeUser(editorId, 2);
      const container = await page.cont("main", "cms.cont.flexible");
      const result = await api(panel, { create: { parent: container.id, title: "Workshops", category: true } }) as { id: number };
      const category = await tree(app).node(result.id);
      const other = await api(panel, { create: { parent: container.id, title: "Private category", category: true } }) as { id: number };
      const hidden = await tree(app).node(other.id);
      await hidden.set("access", 0);
      await hidden.changeUser(editorId, 0);
      const shared = await category.createCont({ module: "cms.cont.event", access: 1 });
      await shared.title("en", "Shared event");
      await shared.changeUser(editorId, 2);
      return { panel, page, category, hidden, shared };
    });
    const editor = await context(editorId);
    const event = await requestStorage.run(editor, async () => {
      const result = await api(panel, { create: { parent: category.id, title: "Pottery" } }) as { id: number; url: string };
      const event = await tree(app).node(result.id);
      assertEquals(event.vs.basis, category.id);
      assertEquals(event.vs.access, 0);
      assertEquals(await event.access(), 3);
      assertEquals(Boolean(result.url), true);
      await add(event, { start: "2027-07-12", end: "2027-07-13" });
      await assertRejects(() => api(panel, { move: { event: event.id, category: hidden.id } }), AccessError);
      await assertRejects(() => api(panel, { visibility: { id: shared.id, inherit: false } }), AccessError);
      const denied = new AbortController();
      tree(app).on("module:access", (event) => { event.access = 0; }, { signal: denied.signal });
      try { await assertRejects(() => api(panel, { create: { parent: category.id, title: "Module denied" } }), AccessError); }
      finally { denied.abort(); }
      return event;
    });
    const period = { start: "2027-07-01", end: "2027-08-01", timeZone: "UTC" };
    const detailContext = await context(editorId, `http://qino.test/?event=${event.id}`);
    await requestStorage.run(detailContext, async () => {
      const html = String(await render(panel, { ctx: detailContext }));
      assertStringIncludes(html, "data-event-texts");
      assertStringIncludes(html, `data-event-widget="${event.id}"`);
      await api(panel, { texts: { id: event.id, lang: app.languages.def, title: "Pottery", location: "Workshop hall", main: "<p>Learn pottery</p>" } });
      assertEquals((await event.showText("main", app.languages.def)).plain(), "Learn pottery");
      await assertRejects(() => api(panel, { texts: { id: event.id, lang: "invalid", title: "Wrong", location: "", main: "" } }));
      await event.set("online_end", 1);
      assertEquals((await app.modules.get("cms.cont.event")!.plugin.cms.node.api(event, { blocks: true })).length, 1);
      await event.set("online_end", 0);
    });
    await requestStorage.run(await context(), async () => {
      assertEquals(await entries((await context()), period), []);
      const rendered = String(await categoryPlugin.node.render(category, { ctx: await context() }));
      assertEquals(rendered.includes("Pottery"), false);
    });
    await requestStorage.run(await context(editorId), () => api(panel, { visibility: { id: event.id, inherit: true } }));
    await requestStorage.run(await context(), async () => {
      assertEquals((await entries(await context(), period)).length, 1);
      const html = String(await categoryPlugin.node.render(category, { ctx: await context() }));
      assertStringIncludes(html, "Pottery");
      assertStringIncludes(html, 'datetime="2027-07-12"');
    });
    await requestStorage.run(await context(readerId), async () => {
      await assertRejects(() => api(panel, { visibility: { id: event.id, inherit: false } }), AccessError);
      const rendered = String(await render(panel, { ctx: await context(readerId) }));
      assertStringIncludes(rendered, "Pottery");
      assertEquals(rendered.includes("Private category"), false);
      assertEquals(rendered.includes("data-event-visibility"), false);
      const ctx = await context(readerId, `http://qino.test/?event=${event.id}`);
      const detail = String(await render(panel, { ctx }));
      assertEquals(detail.includes("data-event-widget"), false);
      assertStringIncludes(detail, "disabled");
      await assertRejects(() => api(panel, { texts: { id: event.id, lang: app.languages.def, title: "Denied", location: "", main: "" } }), AccessError);
    });
    await requestStorage.run(await context(editorId), async () => {
      await assertRejects(() => api(panel, { create: { parent: hidden.id, title: "Denied" } }), AccessError);
      await assertRejects(() => api(panel, { move: { event: page.id, category: category.id } }));
      await api(panel, { visibility: { id: event.id, inherit: false } });
      await assertRejects(() => api(panel, { create: { parent: page.id, title: "Wrong target" } }));
    });
    await requestStorage.run(admin, async () => {
      await api(panel, { move: { event: event.id, category: hidden.id } });
      await api(panel, { visibility: { id: event.id, inherit: true } });
    });
    await requestStorage.run(await context(), async () => {
      assertEquals(await entries(await context(), period), []);
    });
    await requestStorage.run(admin, async () => {
      const second = await category.parent();
      const next = await api(panel, { create: { parent: second!.id, title: "Courses", category: true } }) as { id: number };
      await api(panel, { move: { event: event.id, category: next.id } });
      assertEquals(Number(event.vs.basis), next.id);
      const title = category.vs.title_id;
      for (let i = 0; i < 51; i++) await app.db.table("page").insert({ basis: category.id, module: "cms.cont.event", type: "c", title_id: title, access: 1, online_start: 0, online_end: 0, sort: i });
      const html = String(await render(panel, { ctx: admin }));
      assertEquals(html.split("<th scope=row>").length - 1, 50);
      assertStringIncludes(html, "page=2");
      assertStringIncludes(html, 'datetime="2027-07-12"');
      assertStringIncludes(html, `event=${event.id}`);
      assertStringIncludes(html, "<tr u2-href>");
      assertEquals(html.includes("name=schedule"), false);
      assertEquals(html.includes("view=categories"), false);
      const publicList = String(await categoryPlugin.node.render(category, { ctx: admin }));
      assertEquals(publicList.split("<li>").length - 1, 20);
      assertStringIncludes(publicList, `cms_event_${category.id}_page=2`);
    });
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
