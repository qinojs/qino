import { App, fs, requestStorage, u2Root } from "@qino/qino";
import { cms, cmsCtx } from "@qino/qino/cms";
import { moduleTemplate } from "@qino/qino/cms.templateParser";
import { assert, assertEquals, assertStringIncludes, testContext } from "@qino/qino/tests";

import { cms as layout } from "../plugin.ts";

const NAME = "cms.layout.standard.2";

async function fixture() {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add(NAME);
  await app.init();
  const cm = cms(app);
  const ctx = await testContext({ app: { db: app.db, modules: app.modules } });
  const root = await cm.node(1);
  await root.createChild({ id: 5, module: NAME, visible: false }); // Conventional CMS system page.
  const page = await root.createChild({ module: NAME });
  await page.title("en", "Example & more");
  cmsCtx(ctx).mainNode = page;
  const render = () => requestStorage.run(ctx, () => layout.node.render(page, { ctx }));
  const close = async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  };
  return { app, cm, ctx, page, render, close };
}

Deno.test("standard.2: isolated install, navigation, starter content and CSS precedence", async () => {
  const f = await fixture();
  try {
    await requestStorage.run(f.ctx, async () => {
      const root = await f.cm.node(1);
      const hidden = await root.createChild({ visible: false, module: NAME });
      await hidden.title("en", "Hidden page");
      const out = await f.render();
      assertStringIncludes(out, ">Home</span>");
      assertStringIncludes(out, 'href="#content"');
      assertStringIncludes(out, "<h1>Example &amp; more</h1>");
      assertStringIncludes(out, "<nav");
      assert(!out.includes("Hidden page"));
      assert(!out.includes("cookiebanner"));
      const global = await f.cm.layoutPage(NAME);
      const nav = await global.cont("nav");
      assertEquals(nav.module?.name, "cms.cont.nav4");
      assertEquals(nav.settings.pathOnly(), true);
      await nav.settings.pathOnly(false);
      await f.render();
      assertEquals(nav.settings.pathOnly(), false);

      const main = await f.page.cont("main");
      assertEquals((await main.conts()).length, 1);
      const section = (await main.conts())[0];
      assertEquals(section.module?.name, "cms.cont.section");
      await main.removeChild(section);
      assert(!String(await f.render()).includes("<h1>"));
      assertEquals((await main.conts()).length, 0);
      await main.set("module", "cms.cont.text");
      await main.text("main", "en", "Replacement");
      assertStringIncludes(await f.render(), "Replacement");
      assertEquals(main.module?.name, "cms.cont.text");

      await requestStorage.run(f.ctx, async () => {
        const mod = f.page.module!;
        const template = moduleTemplate(mod);
        await template.create("#container { color: red; }");
        f.ctx.res.html.styles.clear();
        f.ctx.res.html.styles.add(mod.modUrl + "pub/main.css");
        f.ctx.res.html.styles.add(mod.dataUrl + "pub/main.css");
        await f.render();
        const styles = [...f.ctx.res.html.styles];
        const base = styles.indexOf(u2Root + "class/flex/flex.css");
        const shipped = styles.indexOf(mod.modUrl + "pub/main.css");
        const site = styles.indexOf(mod.dataUrl + "pub/main.css");
        assert(base >= 0 && base < shipped && shipped < site);
        await fs.write(template.file, "<div id=own></div>");
        assertEquals(await f.render(), '<div id="own"></div>');
        await fs.write(template.file, "");
        assertEquals(await f.render(), "");
        await fs.remove(template.file);
        assertStringIncludes(await f.render(), 'id="container"');
        assertEquals(await Deno.stat(template.file).catch(() => null), null);
      });
    });
  } finally {
    await f.close();
  }
});

Deno.test("standard.2: site template controls creation; apps keep separate identity and contents", async () => {
  const a = await fixture();
  const b = await fixture();
  try {
    await a.app.settings.identity.name("Alpha");
    await b.app.settings.identity.name("Beta");
    assertStringIncludes(await a.render(), ">Alpha</span>");
    assertStringIncludes(await b.render(), ">Beta</span>");
    assert(!String(await b.render()).includes("Alpha"));
    const globalA = await a.cm.layoutPage(NAME);
    const navA = await globalA.cont("nav");
    await navA.settings.level(1);
    assertEquals((await (await b.cm.layoutPage(NAME)).cont("nav")).settings.level(), undefined);

    const custom = await (await a.cm.node(1)).createChild({ module: NAME });
    await requestStorage.run(a.ctx, async () => {
      const template = moduleTemplate(custom.module!);
      await template.create("/* Site */");
      await fs.write(template.file, "<main><cms-cont name=main module=cms.cont.text /></main>");
      await layout.node.render(custom, { ctx: a.ctx });
      assertEquals((await custom.cont("main")).module?.name, "cms.cont.text");
      assertEquals((await (await custom.cont("main")).conts()).length, 0);
      await fs.write(template.file, "<div></div>");
      const empty = await (await a.cm.node(1)).createChild({ module: NAME });
      await layout.node.render(empty, { ctx: a.ctx });
      assertEquals((await empty.conts()).length, 0);
    });
  } finally {
    await a.close();
    await b.close();
  }
});

Deno.test("standard.2: initial contents follow parser ownership, declaration order and target page", async () => {
  const f = await fixture();
  try {
    await requestStorage.run(f.ctx, async () => {
      const template = moduleTemplate(f.page.module!);
      await template.create("/* Site */");
      await fs.write(template.file, `<div cms-text=main><cms-cont name=main /></div>`);
      await f.render();
      assertEquals((await f.page.conts()).length, 0);

      await fs.write(template.file, `<div><cms-cont name=main module=cms.cont.text /><cms-cont name=main /></div>`);
      await f.render();
      assertEquals((await f.page.cont("main")).module?.name, "cms.cont.text");
      assertEquals((await (await f.page.cont("main")).conts()).length, 0);

      const page = await (await f.cm.node(1)).createChild({ module: NAME });
      await page.title("en", "Target page");
      const cont = await page.createCont({ module: NAME });
      await fs.write(template.file, `<main><cms-cont name=main node=page /></main>`);
      const output = await layout.node.render(cont, { ctx: f.ctx });
      assertStringIncludes(output, "<h1>Target page</h1>");
      assertEquals((await cont.conts()).length, 0);
      assertEquals((await page.cont("main")).module?.name, "cms.cont.flexible");
    });
  } finally {
    await f.close();
  }
});
