import { test } from "node:test";
import { App, fs } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertEquals } from "@qino/qino/tests";

test("cms.versions: a historical page's file is served as it was, only to editors", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.versions");
  await app.init();
  try {
    const blank = Object.fromEntries((await app.db.columns("usr")).filter((c) => c.Null === "NO" && c.Default == null && c.Key !== "PRI").map((c) => [c.Field, ""]));
    const su = Number(await app.db.table("usr").insert({ ...blank, username: "su", superuser: true, active: true }));
    const sess = await app.sessions.load();
    sess.data.core.userId(su);
    await new Promise((resolve) => setTimeout(resolve, 100)); // the session write is debounced

    const write = async (text: string) => { await fs.write(dir + "a.txt", text); return dir + "a.txt"; };
    const file = await (await cms(app).node(1)).addFile(await write("old")); // on a page: readable
    await (await app.handle(new Request("http://qino.test/"))).body?.cancel(); // a request in between
    await file.replaceBy(await write("new"));
    const replaced = Number(await app.db.one`SELECT max(_vers_log) FROM _vers_file WHERE id = ${file.id}`);

    const get = async (query: string, cookie = `qinoSess=${sess.token}`) =>
      (await app.handle(new Request(`http://qino.test/dbFile/${file.id}/a.txt${query}`, { headers: { cookie } }))).text();
    const before = `?cms_versions_log=${replaced}&cms_versions_page=1`;
    assertEquals(await get(before), "old");
    assertEquals(await get(""), "new");
    assertEquals(await get(before, ""), "new", "without edit access the live file");
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});

test("cms.versions: in log mode the page's file urls carry the version", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.versions");
  await app.init();
  try {
    const blank = Object.fromEntries((await app.db.columns("usr")).filter((c) => c.Null === "NO" && c.Default == null && c.Key !== "PRI").map((c) => [c.Field, ""]));
    const su = Number(await app.db.table("usr").insert({ ...blank, username: "su", superuser: true, active: true }));
    const sess = await app.sessions.load();
    sess.data.core.userId(su);
    await new Promise((resolve) => setTimeout(resolve, 100)); // the session write is debounced

    const html = `<img src="/dbFile/7/u-abc/a.jpg" srcset="/dbFile/7/w-2/a.jpg 2x"><a href="/dbFile/8/b.pdf?exp=1&amp;sig=x">/dbFile/9/c.pdf</a>`;
    app.on("render", ({ ctx }) => { ctx.res.headers.set("Content-Type", "text/html"); ctx.res.body = html; });
    const get = async (query: string) =>
      (await app.handle(new Request(`http://qino.test/${query}`, { headers: { cookie: `qinoSess=${sess.token}` } }))).text();
    assertEquals(await get(""), html, "outside log mode nothing changes");
    const log = Number(await app.db.one`SELECT max(id) FROM log`);

    const at = `cms_versions_log=${log}&cms_versions_page=1`;
    assertEquals(await get(`?${at}`),
      `<img src="/dbFile/7/u-abc/a.jpg?${at}" srcset="/dbFile/7/w-2/a.jpg?${at} 2x">` +
      `<a href="/dbFile/8/b.pdf?exp=1&amp;sig=x&${at}">/dbFile/9/c.pdf?${at}</a>`);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
