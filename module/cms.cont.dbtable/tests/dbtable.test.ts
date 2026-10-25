import { App, Ctx, requestStorage } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assertEquals } from "@qino/qino/tests";

import { cms as dbtable } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

async function setup() {
  const dir = await Deno.makeTempDir() + "/";
  const app = new App({ db: "sqlite::memory:", dir });
  app.stores.add(import.meta.resolve("../../store.json")).add("cms").add("cms.cont.dbtable");
  await app.init();
  await app.db.exec`CREATE TABLE school (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`;
  await app.db.exec`CREATE TABLE pupil (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, school_id INTEGER, owner INTEGER)`;
  await app.db.exec`INSERT INTO school (name) VALUES ('North'), ('South')`;
  await app.db.exec`INSERT INTO pupil (name, school_id, owner) VALUES ('Anna', 1, 7), ('Ben', 2, 7), ('Cleo', 1, 8)`;
  await app.db.loadTables();
  const page = await (await cms(app).node(1)).createChild({ access: 1, online_start: 0 });
  const ctx = await Ctx.create(app, new Request("http://qino.test/?id=7"), { appUrl: "/" });
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

const list = (node: Node) => node.createCont({
  module: "cms.cont.dbtable",
  settings: {
    table: "pupil", order: "name",
    field_order: "name,school,owner",
    fields: {
      name: { type: "text", edit: true, search: true, sort: true },
      school: { path: "school_id.name" },
      owner: { fix: true, default: "{id}" },
    },
  },
});

Deno.test("cms.cont.dbtable: fields along references, bounded by a fixed field, searched", async () => {
  const { page, run, close } = await setup();
  try {
    const node = await list(page);
    const out = await run(async () => String(await node.htmlRaw()));
    // only the owner's rows (?id=7), with the school's name joined, in the configured order
    const rows = [...out.matchAll(/<tr data-row="(\d+)"><td><input data-f="name"[^>]*value="(\w+)"><td>(\w+)/g)].map((m) => m.slice(1).join(" "));
    assertEquals(rows, ["1 Anna North", "2 Ben South"], out);
    assertEquals(out.includes("Cleo"), false);

    await run(() => dbtable.node.api(node, { do: "search", value: "be", id: "7" }));
    const searched = await run(async () => String(await node.htmlRaw()));
    assertEquals([searched.includes("Ben"), searched.includes("Anna")], [true, false]);
  } finally {
    await close();
  }
});

Deno.test("cms.cont.dbtable: a row the list does not reach is not touched", async () => {
  const { app, page, run, close } = await setup();
  try {
    const node = await list(page);
    // Cleo belongs to owner 8: out of reach for the list of owner 7
    assertEquals(await run(() => dbtable.node.api(node, { do: "update", row: 3, field: "name", value: "X", id: "7" })), { error: "not editable" });
    assertEquals(await app.db.one`SELECT name FROM pupil WHERE id = 3`, "Cleo");
    assertEquals(await run(() => dbtable.node.api(node, { do: "update", row: 1, field: "name", value: "Ann", id: "7" })), { value: "Ann" });
    // a joined field is never written
    assertEquals(await run(() => dbtable.node.api(node, { do: "update", row: 1, field: "school", value: "X", id: "7" })), { error: "not editable" });
    // a new row takes the fixed value
    const { id } = await run(() => dbtable.node.api(node, { do: "insert", values: { owner: 99 }, id: "7" })) as unknown as { id: number };
    assertEquals(await app.db.one`SELECT owner FROM pupil WHERE id = ${id}`, 7);
  } finally {
    await close();
  }
});
