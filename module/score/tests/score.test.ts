import { Db, unixTime } from "@qino/qino";
import { assert, assertEquals, assertThrows } from "@qino/qino/tests";

import { forget, hit, prune, scored, sqlScore, strength } from "../mod.ts";
import { cron, dbSchema, init, install } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

import type { App } from "@qino/qino";

const { name, dependencies } = manifest;

const DAY = 86400;

const ranked = (db: Db) => db.col<number>`SELECT id FROM score ORDER BY score DESC`;
const stored = (db: Db, id: number) => db.one<number>`SELECT score FROM score WHERE id = ${id}`;

async function testDb(): Promise<Db> {
  const db = new Db("sqlite:");
  await db.migrate(dbSchema);
  await db.exec`CREATE TABLE doc (id INTEGER PRIMARY KEY AUTOINCREMENT, usr_id INTEGER)`;
  await scored(db, "doc", 30 * DAY);
  return db;
}

Deno.test("score: metadata is wired", () => {
  assertEquals(name, "score");
  assertEquals(dependencies, ["core", "cron"]);
  assertEquals(cron.prune.every, "day");
});

Deno.test("score: the table name is stored once, the scores carry its id", async () => {
  await using db = await testDb();
  await scored(db, "page", 7 * DAY);
  await hit(db, "doc", 1);
  await hit(db, "page", 1);

  assertEquals(await db.query`SELECT id, tbl FROM score_scope ORDER BY id`, [{ id: 1, tbl: "doc" }, { id: 2, tbl: "page" }]);
  assertEquals(await db.col`SELECT scope_id FROM score ORDER BY scope_id`, [1, 2]);

  // a second registration reuses the row instead of inserting another
  await scored(db, "doc", 30 * DAY);
  assertEquals(await db.one`SELECT COUNT(*) FROM score_scope`, 2);
});

Deno.test("score: the composite index is created once and survives a migration", async () => {
  await using db = await testDb();
  const indexes = () => db.col<string>`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'score'`;
  const app = { db } as App;

  await install({ app });
  await install({ app }); // idempotent — install runs on every link
  assertEquals((await indexes()).filter((i) => i === "score_scope_score").length, 1);

  // The module migrates with { patch: true }; a name outside the "idx_score_" namespace stays.
  await db.migrate(dbSchema, { patch: true });
  assert((await indexes()).includes("score_scope_score"));
});

Deno.test("score: hits accumulate and rank", async () => {
  await using db = await testDb();
  await hit(db, "doc", 1);
  await hit(db, "doc", 2);
  await hit(db, "doc", 2);
  await hit(db, "doc", 3, 5);

  assertEquals(await ranked(db), [3, 2, 1]);
  assert(Math.abs(strength(db, "doc", (await stored(db, 2))!) - 2) < 1e-6);
});

Deno.test("score: recency beats a stale majority", async () => {
  await using db = await testDb();
  const now = unixTime();
  const rate = Math.LN2 / (30 * DAY);
  // 10 accesses 180 days ago (6 half-lives → 0.16) vs. one access today
  await db.exec`INSERT INTO score (scope_id, id, score, time) VALUES (1, 1, ${rate * (now - 180 * DAY) + Math.log(10)}, ${now - 180 * DAY})`;
  await hit(db, "doc", 2);

  assertEquals(await ranked(db), [2, 1]);
  assert(Math.abs(strength(db, "doc", (await stored(db, 1))!) - 10 / 64) < 1e-6);
});

Deno.test("score: sqlScore orders a joined query and keeps unscored rows last", async () => {
  await using db = await testDb();
  for (const id of [1, 2, 3, 4]) await db.exec`INSERT INTO doc (id, usr_id) VALUES (${id}, 33)`;
  await db.exec`INSERT INTO doc (id, usr_id) VALUES (9, 34)`;
  await hit(db, "doc", 2);
  await hit(db, "doc", 3);
  await hit(db, "doc", 3);
  await hit(db, "doc", 9);

  const ids = await db.col<number>`
    SELECT f.id FROM doc f
    WHERE f.usr_id = ${33}
    ORDER BY ${sqlScore(db, "doc", "f.id")} DESC, f.id
    LIMIT 3`;
  assertEquals(ids, [3, 2, 1]);

  // without an alias the default "<tbl>.id" applies
  assertEquals(await db.col<number>`SELECT id FROM doc ORDER BY ${sqlScore(db, "doc")} DESC, id LIMIT 2`, [3, 2]);
});

Deno.test("score: forget weakens or drops, prune deletes", async () => {
  await using db = await testDb();
  await hit(db, "doc", 1, 4);
  await forget(db, "doc", 1, 0.5);
  assert(Math.abs(strength(db, "doc", (await stored(db, 1))!) - 2) < 1e-6);

  await hit(db, "doc", 2);
  await forget(db, "doc", 2);
  assertEquals(await ranked(db), [1]);

  await forget(db, "doc", 1, 0.001); // 0.002 accesses left — below FORGET
  await hit(db, "doc", 3);
  await prune(db);
  assertEquals(await ranked(db), [3]);
});

Deno.test("score: unregistered tables and negative weights are rejected", async () => {
  await using db = await testDb();
  assertThrows(() => hit(db, "page", 1), Error, "not scored");
  assertThrows(() => sqlScore(db, "page"), Error, "not scored");
  assertThrows(() => hit(db, "doc", 1, 0), Error, "weight");
  await forget(db, "page", 1); // unscored: no-op, the delete hook runs for every table
});

Deno.test("score: a deleted row loses its score", async () => {
  await using db = await testDb();
  await db.loadTables();
  init({ db } as App, { signal: new AbortController().signal });
  await db.exec`INSERT INTO doc (id, usr_id) VALUES (1, 33)`;
  await hit(db, "doc", 1);
  await db.table("doc").delete(1);

  assertEquals(await ranked(db), []);
});
