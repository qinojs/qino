import { assertEquals } from "./deps.ts";
import { Db } from "../lib/db/Db.ts";
import { parkText, unparkText } from "../lib/migrateTextLang.ts";

/** The old shape: `text` carried (id, lang, text), so an id repeats once per language. */
async function oldShape(): Promise<Db> {
  const db = new Db("sqlite:");
  await db.exec`CREATE TABLE text (id INTEGER, lang TEXT, text TEXT, log_id INTEGER, log_id_ch INTEGER)`;
  await db.exec`INSERT INTO text (id, lang, text, log_id) VALUES (1,'de','eins',10), (1,'en','one',10), (2,'de','zwei',11)`;
  await db.exec`CREATE TABLE page_text (page_id INTEGER, name TEXT, text_id INTEGER)`;
  await db.exec`INSERT INTO page_text VALUES (5,'main',1), (6,'main',2)`;
  db.schema = { properties: {
    page_text: { additionalProperties: { properties: { text_id: { "x-qg-parent": "text" } } } },
    text_lang: { additionalProperties: { properties: { text_id: { "x-qg-parent": "text" } } } },
  } };
  return db;
}

/** What the schema migration builds between the two halves. */
async function newTables(db: Db) {
  await db.exec`CREATE TABLE text (id INTEGER PRIMARY KEY AUTOINCREMENT, log_id INTEGER)`;
  await db.exec`CREATE TABLE text_lang (text_id INTEGER, lang TEXT, text TEXT, log_id_ch INTEGER, PRIMARY KEY (text_id, lang))`;
  await db.loadTables();
}

Deno.test("migrateTextLang: the language rows move to text_lang, the ids stay", async () => {
  const db = await oldShape();
  await parkText(db);
  await newTables(db);
  await unparkText(db);

  assertEquals(await db.col`SELECT id FROM text ORDER BY id`, [1, 2]);
  assertEquals(
    (await db.query`SELECT text_id, lang, text FROM text_lang ORDER BY text_id, lang`).map((r) => `${r.text_id}:${r.lang}=${r.text}`),
    ["1:de=eins", "1:en=one", "2:de=zwei"],
  );
  assertEquals(await db.col`SELECT text_id FROM page_text ORDER BY page_id`, [1, 2]); // links still point home
  db.close();
});
