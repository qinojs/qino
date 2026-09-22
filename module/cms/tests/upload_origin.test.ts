import { App } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

Deno.test("cms: a page file upload is only taken from the site's own origin", async () => {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms");
  await app.init();
  try {
    const blank = Object.fromEntries((await app.db.columns("usr")).filter((c) => c.Null === "NO" && c.Default == null && c.Key !== "PRI").map((c) => [c.Field, ""]));
    const su = Number(await app.db.table("usr").insert({ ...blank, username: "su", superuser: true, active: true }));
    const sess = await app.sessions.load();
    sess.data.core.userId(su);
    await new Promise((resolve) => setTimeout(resolve, 100)); // the session write is debounced

    const upload = (origin: string) => {
      const body = new FormData();
      body.append("cmsPageFile", new File(["hello"], "a.txt", { type: "text/plain" }));
      return app.handle(new Request("http://qino.test/?cmspid=1", { method: "POST", body, headers: { origin, cookie: `qinoSess=${sess.token}` } }));
    };
    const files = () => app.db.one`SELECT COUNT(*) FROM page_file WHERE page_id = 1`.then(Number);

    const before = await files();
    await (await upload("https://evil.test")).body?.cancel();
    assertEquals(await files(), before, "a foreign page cannot write files with the editor's cookie");
    const res = await upload("http://qino.test");
    assertEquals(typeof (await res.json()).id, "string");
    assertEquals(await files(), before + 1);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  }
});
