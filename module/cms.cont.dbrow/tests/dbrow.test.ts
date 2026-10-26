import { App, Ctx, requestStorage, runAs } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertEquals } from "@qino/qino/tests";

import { cms as dbrow } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

async function setup(url = "http://qino.test/?id=1") {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.cont.dbrow");
  await app.init();
  await app.db.exec`CREATE TABLE school (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`;
  await app.db.exec`CREATE TABLE pupil (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, school_id INTEGER, archived INTEGER)`;
  await app.db.exec`INSERT INTO school (name) VALUES ('North')`;
  await app.db.exec`INSERT INTO pupil (name, school_id, archived) VALUES ('Anna', 1, 0), ('Ben', 1, 1)`;
  await app.db.loadTables();
  const page = await (await cms(app).node(1)).createChild({ access: 1, online_start: 0 });
  const ctx = await Ctx.create(app, new Request(url), { appUrl: "/" });
  ctx.sess = await app.sessions.load();
  ctx.lang = app.languages.def;
  await ctx.initSettings();
  const run = <T>(fn: () => Promise<T>) => requestStorage.run(ctx, fn);
  const close = async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.db.close();
    await Deno.remove(dir, { recursive: true });
  };
  return { app, page, run, close };
}

const row = (node: Node) => node.createCont({
  module: "cms.cont.dbrow",
  settings: {
    table: "pupil", where: "pupil.archived = 0",
    field_order: "name,school",
    fields: { name: { type: "text", edit: true }, school: { path: "school_id.name" } },
  },
});

Deno.test("cms.cont.dbrow: the page's row, label beside value, joined fields to read", async () => {
  const { page, run, close } = await setup();
  try {
    const node = await row(page);
    const out = await run(async () => String(await node.htmlRaw()));
    assertEquals(/<table class=u2-table data-row="1"><tr><th>name<td><input data-f="name"[^>]*value="Anna"><tr><th>school<td>North<\/table>/.test(out), true, out);
  } finally {
    await close();
  }
});

Deno.test("cms.cont.dbrow: a row `where` does not reach is neither shown nor written", async () => {
  const { app, page, run, close } = await setup("http://qino.test/?id=2");
  try {
    const node = await row(page);
    const out = await run(async () => String(await node.htmlRaw()));
    assertEquals([out.includes("Ben"), out.includes("data-row")], [false, false]);
    assertEquals(await run(() => dbrow.node.api(node, { do: "update", row: 2, field: "name", value: "X", id: "2" })), { error: "not editable" });
    assertEquals(await app.db.one`SELECT name FROM pupil WHERE id = 2`, "Ben");
    assertEquals(await run(() => dbrow.node.api(node, { do: "update", row: 1, field: "name", value: "Ann", id: "1" })), { value: "Ann" });
    // a joined field is never written, and a row is never added
    assertEquals(await run(() => dbrow.node.api(node, { do: "update", row: 1, field: "school", value: "X", id: "1" })), { error: "not editable" });
    assertEquals(await run(() => dbrow.node.api(node, { do: "insert", values: { name: "Cleo" } })), { error: "not insertable" });
  } finally {
    await close();
  }
});

Deno.test("cms.cont.dbrow: the widget adds and removes fields as the list's does", async () => {
  const { app, page, close } = await setup();
  try {
    const node = await row(page);
    await app.settings.core.url("https://example.test/");
    const su = Number(await app.db.table("usr").insert({ username: "su@example.test", active: 1, superuser: 1 }));
    const api = (vars: Record<string, unknown>) => runAs(app, su, "test", () => dbrow.node.api(node, vars)) as Promise<Record<string, unknown>>;
    assertEquals(await api({ do: "add", path: "archived" }), { name: "archived" });
    assertEquals(String(await node.settings.field_order), "name,school,archived");
    assertEquals(await api({ do: "remove", name: "archived" }), { name: "archived" });
    assertEquals(String(await node.settings.field_order), "name,school");
    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    await close();
  }
});
