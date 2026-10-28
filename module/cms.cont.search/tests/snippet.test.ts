import { App, Ctx, requestStorage } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertEquals } from "@qino/qino/tests";

Deno.test("cms.cont.search: a hit shows its text once escaped, not its entities", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.cont.search").add("cms.cont.text");
  await app.init();
  try {
    const root = await cms(app).node(1);
    const hit = await root.createChild({ access: 1, searchable: true, online_start: 0 });
    const search = await root.createChild({ access: 1, online_start: 0 });
    const box = await search.createCont({ module: "cms.cont.search" });
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
    // a labelled search landmark, no focus jump, an ordered list with one link per hit
    assertEquals(out.includes("<search><form>"), true, out);
    assertEquals(/<input type=search[^>]*aria-label=/.test(out), true, out);
    assertEquals(out.includes("autofocus"), false, out);
    const list = out.slice(out.indexOf("<ol>"), out.indexOf("</ol>"));
    assertEquals(list.match(/<li u2-href>/g)?.length, 1, out);
    assertEquals(list.match(/<a /g)?.length, 1, out);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
