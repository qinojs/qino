import { App, fs, requestStorage } from "@qino/qino";
import { cms, cmsCtx } from "@qino/qino/cms";
import { moduleTemplate } from "@qino/qino/cms.templateParser";
import { assert, assertEquals, assertStringIncludes, testContext } from "@qino/qino/tests";

import { cms as editorial } from "../plugin.ts";

const NAME = "cms.layout.houdini.2";

Deno.test("houdini.2: isolated install reuses the editor but owns its settings, template and contents", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add(NAME);
  await app.init();
  const cm = cms(app);
  const ctx = await testContext({ app: { db: app.db, modules: app.modules } });
  const root = await cm.node(1);
  await root.createChild({ id: 5, module: NAME, visible: false });
  const second = await root.createChild({ module: NAME });
  const first = await root.createChild({ module: "cms.layout.houdini" });
  try {
    await requestStorage.run(ctx, async () => {
      await app.settings.identity.name("A shared identity");
      await first.title("en", "First layout");
      await second.title("en", "Second layout");
      cmsCtx(ctx).mainNode = second;
      const out = await editorial.node.render(second, { ctx });
      assertStringIncludes(out, 'class="houdini houdini-2"');
      assertStringIncludes(out, "A shared identity");
      assertStringIncludes(out, "<h1>Second layout</h1>");
      assertStringIncludes(out, 'id="foot" u2-skin="dark"');
      assertStringIncludes(out, "u2-responsive");
      assertEquals(second.module?.plugin.cms?.node?.widget, "pub/widget.js");
      assertEquals((await (await cm.layoutPage(NAME)).cont("nav")).module?.name, "cms.cont.nav");

      const globalFirst = await cm.layoutPage("cms.layout.houdini");
      const globalSecond = await cm.layoutPage(NAME);
      assert(globalFirst.id !== globalSecond.id);
      await globalFirst.settings.design({ color: "#205040" });
      await globalSecond.settings.design({ color: "#904020" });
      await globalSecond.text("edition", "en", "Independent ideas");
      ctx.res.html.inlineStyles.clear();
      assertStringIncludes(await editorial.node.render(second, { ctx }), "Independent ideas");
      assert([...ctx.res.html.inlineStyles].some((css) => css.includes("#904020")));
      assert(![...ctx.res.html.inlineStyles].some((css) => css.includes("#205040")));

      cmsCtx(ctx).mainNode = first;
      ctx.res.html.inlineStyles.clear();
      const firstOut = await first.module!.plugin.cms.node.render(first, { ctx });
      assert(!firstOut.includes("Independent ideas"));
      assert(!firstOut.includes("houdini-2"));
      assert([...ctx.res.html.inlineStyles].some((css) => css.includes("#205040")));
      assert(![...ctx.res.html.inlineStyles].some((css) => css.includes("#904020")));

      const filesFirst = moduleTemplate(first.module!);
      const filesSecond = moduleTemplate(second.module!);
      assert(filesFirst.file !== filesSecond.file);
      await filesFirst.create("/* First site styles */");
      await filesSecond.create("/* Second site styles */");
      await fs.write(filesSecond.file, "<div>Own editorial template</div>");
      assertEquals(await editorial.node.render(second, { ctx }), "<div>Own editorial template</div>");
      assertStringIncludes(await first.module!.plugin.cms.node.render(first, { ctx }), 'class="houdini"');
      assertEquals(await fs.text(filesFirst.css), "/* First site styles */");
      assertEquals(await fs.text(filesSecond.css), "/* Second site styles */");
    });
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
