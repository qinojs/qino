import { App, requestStorage } from "@qino/qino";
import { cms, cmsCtx } from "@qino/qino/cms";
import { cms as plugin } from "@qino/qino/cms.cont.nav";
import { assert, assertEquals, assertStringIncludes, testContext } from "@qino/qino/tests";

import type { Node } from "@qino/qino/cms";

Deno.test("cms.cont.nav: global navigation, settings and content anchors on a real CMS tree", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.cont.nav");
  await app.init();
  try {
    const cm = cms(app);
    const ctx = await testContext({ app: { db: app.db, modules: app.modules } });
    await requestStorage.run(ctx, async () => {
      const root = await cm.node(1);
      async function page(parent: Node, title: string, fields = {}) {
        const child = await parent.createChild(fields);
        await child.title("en", title);
        return child;
      }
      const services = await page(root, "Services");
      const current = await page(services, "Consulting");
      await page(current, "Detail");
      const contact = await page(root, "Contact");
      await page(contact, "Other branch");
      await page(root, "Hidden", { visible: false });
      await page(root, "Denied", { access: 0 });
      await page(root, "Offline", { online_start: Math.floor(Date.now() / 1000) + 1000 });
      await page(root, "<br>");
      const system = await page(root, "System", { visible: false });
      const anchor = await current.createCont({ visible: true });
      await anchor.title("en", "Section");
      const nested = await anchor.createCont({ visible: true });
      await nested.title("en", "Nested section");
      cmsCtx(ctx).mainNode = current;

      let count = 0;
      const render = async (settings = {}) => {
        const nav = await system.cont(`nav${count++}`, { module: "cms.cont.nav", settings });
        return plugin.node.render(nav, { ctx });
      };
      const output = await render();
      assertStringIncludes(output, "Services");
      assertStringIncludes(output, "Consulting");
      assertStringIncludes(output, "Detail");
      assertStringIncludes(output, "Other branch");
      assertStringIncludes(output, 'aria-current="page"');
      for (const title of ["Hidden", "Denied", "Offline", "System", "Section", "<br>"])
        assert(!output.includes(title), title);

      const shallow = await render({ level: 1 });
      assertStringIncludes(shallow, "Services");
      assert(!shallow.includes("Consulting"));
      assert(!shallow.includes("cmsHasSub"));
      assertStringIncludes(await render({ level: 0 }), "Detail");

      const alongPath = await render({ pathOnly: true });
      assertStringIncludes(alongPath, "Detail");
      assertStringIncludes(alongPath, "Contact");
      assert(!alongPath.includes("Other branch"));

      const fromPage = await render({ startPage: services.id });
      assertStringIncludes(fromPage, "Consulting");
      assert(!fromPage.includes("Contact"));
      const fromLevel = await render({ startPage: contact.id, startLevel: 1 });
      assertStringIncludes(fromLevel, "Consulting");
      assert(!fromLevel.includes("Other branch"));
      assertStringIncludes(await render({ startPage: services.id, startLevel: 0 }), "Contact");
      assertStringIncludes(await render({ startLevel: 99 }), "Contact");
      assertStringIncludes(await render({ startPage: 999999 }), "Contact");
      assertEquals(await render({ startPage: (await page(root, "Private", { access: 0 })).id }), "<span></span>");
      assert(!output.includes("aria-label"));
      const labeled = await system.cont("labeled", "cms.cont.nav");
      await labeled.title("en", "Main & more");
      assertStringIncludes(await plugin.node.render(labeled, { ctx }), '<nav aria-label="Main &amp; more">');

      const hidden = await render({ filter_visible: "hidden" });
      assertStringIncludes(hidden, "Hidden");
      assert(!hidden.includes("Services"));
      const all = await render({ filter_visible: "" });
      assertStringIncludes(all, "Hidden");
      assertStringIncludes(all, "Services");
      assert(!all.includes("Denied"));

      const anchors = await render({ "include contents": true });
      assertStringIncludes(anchors, "Section");
      assertStringIncludes(anchors, "Nested section");
      assert(new RegExp(`<li><a [^>]*class="cmsLink${anchor.id}`).test(anchors));
      assert(new RegExp(`<li><a [^>]*class="cmsLink${nested.id}`).test(anchors));
      assertEquals((anchors.match(/>Nested section<\/a>/g) ?? []).length, 1);

      const defaults = { module: "cms.cont.nav", settings: { level: 1 } };
      const nav = await system.cont("defaults", defaults);
      assertEquals(nav.settings.level(), 1);
      assertEquals(defaults.settings, { level: 1 });
      await nav.settings.level(2);
      const same = await system.cont("defaults", {
        module: "cms.cont.nav", settings: { toJSON() { throw new Error("Existing content must ignore defaults"); } },
      });
      assertEquals(same.id, nav.id);
      assertEquals(same.module?.name, "cms.cont.nav");
      assertEquals(same.settings.level(), 2);
      const text = await system.cont("text", { module: "cms.cont.nav", settings: '{"level":3}' });
      assertEquals(text.settings.level(), 3);
      assertEquals((await system.cont("short", "cms.cont.nav")).module?.name, "cms.cont.nav");
      for (const child of [await system.createChild(defaults), await system.createCont(defaults)]) {
        assertEquals(child.settings.level(), 1);
        assertEquals(child.vs.settings, '{"level":1}');
      }
      assertEquals(defaults.settings, { level: 1 });
    });
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
