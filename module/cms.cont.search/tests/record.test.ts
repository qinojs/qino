import { App, Ctx, requestStorage, unhee } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assert, assertEquals } from "@qino/qino/tests";

Deno.test("cms.cont.search: live searches replace their own entry, clearing starts another, and the backend shows them", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.backend.cms.search");
  await app.init();
  try {
    const root = await cms(app).node(1);
    const backend = await cms(app).nodeByModule("cms.backend.cms.search");
    assert(backend);
    const page = await root.createChild({ access: 1, searchable: true, online_start: 0 });
    await page.title(app.languages.def, "Lemon tart");
    const box = await page.createCont({ module: "cms.cont.search" });
    const other = await page.createCont({ module: "cms.cont.search" });
    const ctx = await Ctx.create(app, new Request("http://qino.test/"), { appUrl: "/" });
    ctx.sess = await app.sessions.load();
    ctx.lang = app.languages.def;
    const log = async (time: number) => String(await app.db.table("log").insert({ time, post: "" }));
    const firstLog = await log(1_700_000_000);
    ctx.logId = Promise.resolve(firstLog);
    await requestStorage.run(ctx, async () => {
      const token = (out: string) => JSON.parse(unhee(out.match(/data-search-entry="([^"]+)"/)![1]));
      assertEquals(String(await box.htmlPart("hits", { search: "" })), "");
      assertEquals(await app.db.one`SELECT COUNT(*) FROM cms_search`, 0);

      const first = token(String(await box.htmlPart("hits", { search: "lem" })));
      const lastLog = await log(1_700_000_060);
      ctx.logId = Promise.resolve(lastLog);
      const last = token(String(await box.htmlPart("hits", { search: "lemon", ...first })));
      assertEquals(last.entry, first.entry);
      assertEquals(await app.db.query`SELECT node_id, log_id, search, lang, hits FROM cms_search`, [
        { node_id: box.id, log_id: Number(lastLog), search: "lemon", lang: ctx.lang, hits: 1 },
      ]);

      // The client drops its token when cleared; no empty search is stored.
      await box.htmlPart("hits", { search: "" });
      const next = token(String(await box.htmlPart("hits", { search: "<script>" })));
      assert(next.entry !== first.entry);
      assertEquals(await app.db.one`SELECT COUNT(*) FROM cms_search`, 2);

      // A different node or session cannot overwrite an entry, even with a valid token.
      await other.htmlPart("hits", { search: "another node", ...first });
      const sess = ctx.sess;
      ctx.sess = await app.sessions.load();
      await box.htmlPart("hits", { search: "another session", ...first });
      ctx.sess = sess;
      await box.htmlPart("hits", { search: "forged", ...first, sig: "forged" });
      assertEquals(await app.db.one`SELECT search FROM cms_search WHERE id = ${first.entry}`, "lemon");
      assertEquals(await app.db.one`SELECT COUNT(*) FROM cms_search`, 5);

      const out = String(await backend.htmlRaw());
      assert(out.includes("Frequent search terms") && out.includes("Searches without results") && out.includes("Recent searches"), out);
      assert(out.includes("&lt;script&gt;") && !out.includes("<script>"), out);
      assert(out.includes("2023-11-14T22:14:20.000Z"), out);
      assert(!out.includes("[object Promise]"), out);
    });
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
