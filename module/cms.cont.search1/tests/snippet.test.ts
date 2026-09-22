import { App, Ctx, requestStorage } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertEquals } from "@qino/qino/tests";

Deno.test("cms.cont.search1: a hit shows its text once escaped, not its entities", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.cont.search1").add("cms.cont.text");
  await app.init();
  try {
    const root = await cms(app).node(1);
    const hit = await root.createChild({ access: 1, searchable: true, online_start: 0 });
    const search = await root.createChild({ access: 1, online_start: 0 });
    const box = await search.createCont({ module: "cms.cont.search1" });
    const ctx = await Ctx.create(app, new Request("http://qino.test/?cms_search=rocks"), { appUrl: "/" });
    ctx.sess = await app.sessions.load();
    ctx.lang = app.languages.def;
    const out = await requestStorage.run(ctx, async () => {
      await hit.title(ctx.lang, "Hit");
      await hit.text("main", ctx.lang, "<p>Q&amp;A rocks</p>");
      return String(await box.htmlRaw());
    });
    assertEquals(out.includes("Q&amp;A"), true, out);
    assertEquals(out.includes("&amp;amp;"), false, out);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
