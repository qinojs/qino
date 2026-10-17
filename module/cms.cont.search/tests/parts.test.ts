import { App, Ctx, requestStorage } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertEquals } from "@qino/qino/tests";

Deno.test("cms.cont.search: the hits part renders alone; grouped by contents a hit links to its section", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.cont.search").add("cms.cont.text");
  await app.init();
  try {
    const root = await cms(app).node(1);
    const ctx = await Ctx.create(app, new Request("http://qino.test/"), { appUrl: "/" });
    ctx.sess = await app.sessions.load();
    ctx.lang = app.languages.def;
    const out = await requestStorage.run(ctx, async () => {
      const page = await root.createChild({ access: 1, searchable: true, online_start: 0 });
      await page.title(ctx.lang, "Menu");
      const section = await page.createCont({ visible: true });
      await section.title(ctx.lang, "Desserts");
      const text = await section.createCont({ module: "cms.cont.text" });
      await text.text("main", ctx.lang, "<p>Lemon tart</p>");
      const box = await (await root.createChild({ access: 1, online_start: 0 })).createCont({ module: "cms.cont.search" });

      const byPage = String(await box.htmlPart("hits", { search: "lemon" }));
      await box.settings["group by"]("contents");
      const bySection = String(await box.htmlPart("hits", { search: "lemon" }));
      return { byPage, bySection, empty: String(await box.htmlPart("hits", { search: "" })) };
    });
    assertEquals(out.byPage.includes(">Menu</a>"), true, out.byPage);
    assertEquals(out.bySection.includes(">Desserts</a>"), true, out.bySection);
    assertEquals(out.empty, "");
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
