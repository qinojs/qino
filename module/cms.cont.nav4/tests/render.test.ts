import { App, requestStorage } from "@qino/qino";
import { cms, cmsCtx } from "@qino/qino/cms";
import { cms as nav4 } from "@qino/qino/cms.cont.nav4";
import { assert, assertEquals, assertStringIncludes, testContext } from "@qino/qino/tests";

import type { Node } from "@qino/qino/cms";

Deno.test("nav4: global navigation, settings and content anchors on a real CMS tree", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.cont.nav4");
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
      const detail = await page(current, "Detail");
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
        const nav = await system.cont(`nav${count++}`, { module: "cms.cont.nav4", settings });
        return nav4.node.render(nav, { ctx });
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
      assert(!String(await render({ startPage: (await page(root, "Private", { access: 0 })).id })).includes("<ul"));

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
      assertStringIncludes(anchors, `<li class="cmsLink${anchor.id}">`);
      assertStringIncludes(anchors, `<li class="cmsLink${nested.id}">`);
      assertEquals((anchors.match(/>Nested section<\/a>/g) ?? []).length, 1);

      const defaults = { module: "cms.cont.nav4", settings: { level: 1 } };
      const nav = await system.cont("defaults", defaults);
      assertEquals(nav.settings.level(), 1);
      assertEquals(defaults.settings, { level: 1 });
      await nav.settings.level(2);
      const same = await system.cont("defaults", {
        module: "cms.cont.nav3", settings: { toJSON() { throw new Error("Existing content must ignore defaults"); } },
      });
      assertEquals(same.id, nav.id);
      assertEquals(same.module?.name, "cms.cont.nav4");
      assertEquals(same.settings.level(), 2);
      const text = await system.cont("text", { module: "cms.cont.nav4", settings: '{"level":3}' });
      assertEquals(text.settings.level(), 3);
      assertEquals((await system.cont("short", "cms.cont.nav4")).module?.name, "cms.cont.nav4");
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
