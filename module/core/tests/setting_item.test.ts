import { assertEquals } from "./deps.ts";
import { Db } from "../lib/db/Db.ts";
import { createSettingItem } from "../lib/SettingItem.ts";
import { itemReadDeep } from "../lib/util.ts";

async function setup() {
  const db = new Db("sqlite::memory:");
  await db.query`CREATE TABLE qg_setting (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    basis INTEGER NOT NULL DEFAULT 0,
    "offset" TEXT NOT NULL DEFAULT '',
    value TEXT,
    type INTEGER NOT NULL DEFAULT 0,
    handler TEXT NOT NULL DEFAULT '',
    options TEXT NOT NULL DEFAULT '',
    w INTEGER NOT NULL DEFAULT 0
  )`;
  await db.loadTables();
  return db;
}

const rowCount = async (db: Db) => Number(await db.one`SELECT count(*) FROM qg_setting`);

/** Read a persisted subtree through a fresh root, so cached in-memory items can't mask a missing DELETE. */
const readBack = (db: Db, path: string[]) => itemReadDeep(createSettingItem(db).sub(path));

Deno.test("SettingItem: object-set replaces — keys absent from the new object are removed", async () => {
  const db = await setup();
  const root = createSettingItem(db);

  await root.sub(["ui"]).set({ a: "1", b: "2", c: "3" });
  assertEquals(await readBack(db, ["ui"]), { a: "1", b: "2", c: "3" });
  assertEquals(await rowCount(db), 4); // ui + a,b,c

  await root.sub(["ui"]).set({ a: "9" }); // b and c must be deleted, not merged
  assertEquals(await readBack(db, ["ui"]), { a: "9" });
  assertEquals(await rowCount(db), 2); // ui + a

  await db.close();
});

Deno.test("SettingItem: object-set replace cascades into nested objects", async () => {
  const db = await setup();
  const root = createSettingItem(db);

  await root.sub(["cfg"]).set({ menu: { x: "1", y: "2" }, keep: "k" });
  assertEquals(await readBack(db, ["cfg"]), { menu: { x: "1", y: "2" }, keep: "k" });

  await root.sub(["cfg"]).set({ menu: { x: "9" }, keep: "k" }); // nested y gone
  assertEquals(await readBack(db, ["cfg"]), { menu: { x: "9" }, keep: "k" });

  await db.close();
});

Deno.test("SettingItem: leaf write does not touch sibling keys", async () => {
  const db = await setup();
  const root = createSettingItem(db);

  await root.sub(["ui"]).set({ a: "1", b: "2" });
  await root.sub(["ui", "a"]).set("9"); // primitive leaf update, b untouched
  assertEquals(await readBack(db, ["ui"]), { a: "9", b: "2" });

  await db.close();
});

Deno.test("SettingItem: two leaf writes under one branch do not duplicate the branch", async () => {
  const db = await setup();
  const root = createSettingItem(db);

  // Autovivifying a branch used to return its null value, which turned the branch into a
  // primitive and cleared its children — the second write then inserted a second branch row,
  // and both leaves became unreachable.
  await root.sub(["shop", "vat", "mode"]).set("excluded");
  await root.sub(["shop", "vat", "rate"]).set("20");

  assertEquals(await readBack(db, ["shop"]), { vat: { mode: "excluded", rate: "20" } });
  assertEquals(Number(await db.one`SELECT count(*) FROM qg_setting WHERE "offset" = ${"vat"}`), 1);

  await db.close();
});
