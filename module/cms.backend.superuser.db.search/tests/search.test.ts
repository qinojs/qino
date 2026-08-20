import { Db, requestStorage } from "@qino/qino";
import { assert, assertEquals, assertStringIncludes, fakeT, testContext } from "@qino/qino/tests";

import { search } from "../lib/search.ts";
import { render } from "../render.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name, dependencies } = manifest;

/** `big` is past the scan limit, `small` is not — the two sides of the plan. */
async function testDb(): Promise<Db> {
  const db = new Db("sqlite:");
  await db.exec`CREATE TABLE big (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, body TEXT)`;
  await db.exec`CREATE INDEX idx_big_title ON big (title)`;
  await db.exec`CREATE TABLE small (id INTEGER PRIMARY KEY AUTOINCREMENT, note TEXT)`;
  await db.loadTables();
  await db.table("big").insert({ title: "Hello world", body: "needle in the body" });
  for (let i = 0; i < 300; i++) await db.table("big").insert({ title: `filler ${i}`, body: "x" });
  await db.table("small").insert({ note: "a needle in a small table" });
  return db;
}

const plan = (result: { table: string; parts: { mode: string; fields: string[] }[] }[]) =>
  result.map((r) => [r.table, ...r.parts.map((p) => `${p.mode}:${p.fields.join(",")}`)]);

async function renderSearch(db: Db, term: string): Promise<string> {
  const ctx = await testContext({ url: `http://qino.test/?db_search=${encodeURIComponent(term)}`, app: { db, t: fakeT } });
  return String(await requestStorage.run(ctx, () => render({ app: { db, t: fakeT } } as never)));
}

Deno.test("cms.backend.superuser.db.search: metadata is wired", () => {
  assertEquals(name, "cms.backend.superuser.db.search");
  assertEquals(dependencies, ["cms.backend.superuser.db"]);
});

Deno.test("cms.backend.superuser.db.search: large tables only through their indexes", async () => {
  await using db = await testDb();
  // indexed field, word prefix — a substring of it stays unfound
  assertEquals(plan(await search(db, "hello")), [["big", "prefix:title"]]);
  assertEquals(await search(db, "ello"), []);
  // `needle` sits in an unindexed column: scanned in the small table, out of reach in the large one
  assertEquals(plan(await search(db, "needle")), [["small", "scan:note"]]);
  // a numeric term matches the primary key exactly, in every table
  assertEquals(plan(await search(db, "1")), [["big", "exact:id", "prefix:title"], ["small", "exact:id", "scan:note"]]);
  assertEquals(await search(db, "nothinghere"), []);
});

Deno.test("cms.backend.superuser.db.search: renders one table per hit, marked and timed", async () => {
  await using db = await testDb();
  const out = await renderSearch(db, "hello");
  assertStringIncludes(out, "<mark>Hello</mark> world");
  assertStringIncludes(out, "prefix: title");
  assert(/[\d.]+ ms/.test(out));
  assertEquals(out.match(/<table/g)?.length, out.match(/<\/table>/g)?.length);

  const empty = await renderSearch(db, "");
  assert(!empty.includes("<table"));
});
