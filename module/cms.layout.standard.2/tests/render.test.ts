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
      assertEquals(nav.settings.pathOnly(), undefined);
      assertStringIncludes(out, 'id="head-nav" popover');

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
        await f.render();
        assert(f.ctx.res.html.styles.has(u2Root + "class/flex/flex.css"));
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

Deno.test("standard.2: starter content follows the module the template gives main", async () => {
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
    });
  } finally {
    await f.close();
  }
});

Deno.test("standard.2: starter titles are editable language snapshots; removed slots stay absent", async () => {
  const f = await fixture();
  try {
    f.app.languages.setLangs(["en", "de"]);
    await f.page.title("de", "Deutsch <em>Titel</em> & mehr");
    await requestStorage.run(f.ctx, async () => {
      const template = moduleTemplate(f.page.module!);
      await template.create("/* Site */");
      await fs.write(template.file, "<main><cms-cont name=main /></main>");
      await f.render();
      assertEquals((await (await f.cm.layoutPage(NAME)).conts()).length, 0);
      const main = await f.page.cont("main");
      const text = await (await main.conts())[0].cont("main");
      assertEquals(await (await text.text("main", "de")).get(), "<h1>Deutsch Titel &amp; mehr</h1>");
      await text.text("main", "en", "<h1>Editorial title</h1>");
      await f.page.title("en", "Changed page title");
      await f.render();
      assertEquals(await (await text.text("main", "en")).get(), "<h1>Editorial title</h1>");
      await fs.write(template.file, "<div></div>");
      assertEquals(await f.render(), "<div></div>");
      assertEquals((await main.conts()).length, 1);
      assertEquals(await (await text.text("main", "en")).get(), "<h1>Editorial title</h1>");
    });
  } finally {
    await f.close();
  }
});
