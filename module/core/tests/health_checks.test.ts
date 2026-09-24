// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "./deps.ts";
import { Db } from "../lib/db/Db.ts";
import { healthChecks } from "../healthChecks.ts";
import { fakeSettings } from "./appFake.ts";
import { requestStorage } from "../lib/ctx/Ctx.ts";

import dbSchema from "../dbschema.json" with { type: "json" };

// page/page_text live in the cms module; rebuilt here so core stays testable on its own.
const schema = structuredClone(dbSchema) as any;
schema.properties.page = { additionalProperties: { properties: {
  id:       { type: "integer", "x-index": "primary", "x-autoincrement": true },
  title_id: { type: "integer", "x-index": true, "x-qg-parent": "text", "x-qg-on-parent-delete": "setnull" },
} } };
schema.properties.page_text = { additionalProperties: { properties: {
  page_id: { type: "integer", "x-index": "primary", "x-qg-parent": "page", "x-qg-on-parent-delete": "cascade" },
  name:    { type: "string", maxLength: 128, "x-index": "primary" },
  text_id: { type: "integer", "x-index": true, "x-qg-parent": "text", "x-qg-on-parent-delete": "cascade" },
} } };

async function app() {
  const db = new Db("sqlite::memory:");
  await db.migrate(schema);
  db.schema = schema; // the App does this; children() reads x-qg-parent from it
  await db.loadTables();
  await db.exec`INSERT INTO text (id) VALUES (1), (2), (3)`;
  await db.exec`INSERT INTO text_lang (text_id, lang, text) VALUES (1,'de','in a page'), (2,'de','a title'), (3,'de','orphan')`;
  await db.exec`INSERT INTO page (id, title_id) VALUES (10, 2)`;
  await db.exec`INSERT INTO page_text (page_id, name, text_id) VALUES (10, 'main', 1)`;
  return { db, settings: fakeSettings(), modules: { all: () => new Map() }, [Symbol.asyncDispose]: () => db.close() } as any;
}

const ids = (db: Db) => db.query`SELECT id FROM text ORDER BY id`.then((r) => r.map((x) => Number(x.id)));

Deno.test("healthChecks: only the text nothing points at counts as unused", async () => {
  await using a = await app();
  const found = await (await healthChecks(a)).cleanup["not linked texts"]() as any;
  assertEquals(found.info, "found 1");
  assertEquals(await found.solutions.run.solve(), "1 rows deleted\n");
  assertEquals(await ids(a.db), [1, 2]); // page_text link and page title both keep their text
});

Deno.test("healthChecks: a text's own language rows are not a use of it", async () => {
  await using a = await app();
  await a.db.exec`DELETE FROM page_text`;
  const found = await (await healthChecks(a)).cleanup["not linked texts"]() as any;
  assertEquals(found.info, "found 2"); // text 1 is now unlinked, its text_lang row must not save it
  await found.solutions.run.solve();
  assertEquals(await ids(a.db), [2]);
  assertEquals(Number(await a.db.one`SELECT count(*) FROM text_lang`), 1);
});

const onUrl = <T>(url: string, fn: () => T): T =>
  requestStorage.run({ req: { url: new URL(url), appUrl: "/" } } as any, fn);

Deno.test("healthChecks: the address you are on differs from core.url", async () => {
  await using a = await app();
  a.settings = fakeSettings({ core: fakeSettings({ url: "https://set.example/" }) });
  const check = (await healthChecks(a)).warning["public address is not the one you are on"];
  assertEquals(await onUrl("https://set.example/", check), undefined); // same address, trailing slash aside
  const found = await onUrl("https://other.example/", check) as any;
  assertEquals(found.info, "mails and jobs link to https://set.example/");
  assertEquals(Object.keys(found.solutions), ["set it to: https://other.example/"]);
});

Deno.test("healthChecks: a corrupt SQLite database is reported", async () => {
  const file = await Deno.makeTempFile({ suffix: ".sqlite" });
  const open = async (migrate = false) => {
    const db = new Db(`sqlite:${file}`);
    if (migrate) await db.migrate(schema);
    db.schema = schema;
    await db.loadTables();
    return { db, settings: fakeSettings(), modules: { all: () => new Map() }, [Symbol.asyncDispose]: () => db.close() } as any;
  };
  try {
    {
      await using a = await open(true);
      assertEquals(await (await healthChecks(a)).error["corrupt tables"](), undefined);
      await a.db.exec`CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)`;
      await a.db.exec`CREATE INDEX t_v ON t (v)`;
      for (let i = 0; i < 200; i++) await a.db.exec`INSERT INTO t (v) VALUES (${"x".repeat(100) + i})`;
    }
    // overwrite a page of t at the end of the file
    const bytes = await Deno.readFile(file);
    const pageSize = (bytes[16] << 8) | bytes[17];
    bytes.fill(0xff, bytes.length - 2 * pageSize, bytes.length - pageSize);
    await Deno.writeFile(file, bytes);
    await using a = await open();
    const found = await (await healthChecks(a)).error["corrupt tables"]() as any;
    assertEquals(found.info.startsWith("database: "), true);
    assertEquals(found.solutions, undefined); // no repair outside MySQL
  } finally {
    await Deno.remove(file);
  }
});
