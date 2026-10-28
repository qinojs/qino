import { Db, sql, unixTime } from "@qino/qino";
import { assert, assertEquals, assertThrows } from "@qino/qino/tests";

import { forget, halfLife, hit, prune, scores, sqlScore, strength } from "../mod.ts";
import { cron, dbSchema } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name, dependencies } = manifest;

const DAY = 86400;

// What a module declares: its key columns only.
const declared = { properties: {
  doc: { additionalProperties: { properties: {
    id: { type: "integer", "x-index": "primary", "x-autoincrement": true },
    usr_id: { type: "integer" },
  } } },
  score_doc_view: { additionalProperties: { properties: { doc_id: { type: "integer", "x-qg-parent": "doc" } } } },
  score_doc_usr: { additionalProperties: { properties: {
    usr_id: { type: "integer" },
    doc_id: { type: "integer", "x-qg-parent": "doc" },
  } } },
} };

const ranked = (db: Db) => db.col<number>`SELECT doc_id FROM score_doc_view ORDER BY score DESC`;
const stored = (db: Db, id: number) => db.one<number>`SELECT score FROM score_doc_view WHERE doc_id = ${id}`;

async function testDb() {
  const db = new Db("sqlite:");
  db.schema = { properties: { ...declared.properties, ...dbSchema(declared).properties } };
  await db.migrate(db.schema);
  await db.loadTables();
  return db;
}

Deno.test("score: metadata is wired", () => {
  assertEquals(name, "score");
  assertEquals(dependencies, ["core", "cron"]);
  assertEquals(cron.prune.every, "day");
});

Deno.test("score: a declared table gets its key, score and time", async () => {
  await using db = await testDb();
  assertEquals(scores(db).map(({ name, keys, half }) => ({ name, keys, half })), [
    { name: "doc_view", keys: ["doc_id"], half: 30 * DAY },
    { name: "doc_usr", keys: ["usr_id", "doc_id"], half: 30 * DAY },
  ]);
  assertEquals((await db.columns("score_doc_usr")).map((c) => c.Field), ["usr_id", "doc_id", "score", "time"]);
  halfLife(db, "doc_view", 7 * DAY);
  assertEquals(scores(db)[0].half, 7 * DAY);
});

Deno.test("score: hits accumulate and rank", async () => {
  await using db = await testDb();
  await hit(db, "doc_view", { doc_id: 1 });
  await hit(db, "doc_view", { doc_id: 2 });
  await hit(db, "doc_view", { doc_id: 2 });
  await hit(db, "doc_view", { doc_id: 3 }, 5);

  assertEquals(await ranked(db), [3, 2, 1]);
  assert(Math.abs(strength(db, "doc_view", (await stored(db, 2))!) - 2) < 1e-6);
});

Deno.test("score: recency beats a stale majority", async () => {
  await using db = await testDb();
  const now = unixTime();
  const rate = Math.LN2 / (30 * DAY);
  // 10 accesses 180 days ago (6 half-lives → 0.16) vs. one access today
  await db.exec`INSERT INTO score_doc_view (doc_id, score, time) VALUES (1, ${rate * (now - 180 * DAY) + Math.log(10)}, ${now - 180 * DAY})`;
  await hit(db, "doc_view", { doc_id: 2 });

  assertEquals(await ranked(db), [2, 1]);
  assert(Math.abs(strength(db, "doc_view", (await stored(db, 1))!) - 10 / 64) < 1e-6);
});

Deno.test("score: sqlScore orders a joined query and keeps unscored rows last", async () => {
  await using db = await testDb();
  for (const id of [1, 2, 3, 4]) await db.exec`INSERT INTO doc (id, usr_id) VALUES (${id}, 33)`;
  await db.exec`INSERT INTO doc (id, usr_id) VALUES (9, 34)`;
  for (const id of [2, 3, 3, 9]) await hit(db, "doc_view", { doc_id: id });

  const ids = await db.col<number>`
    SELECT f.id FROM doc f
    WHERE f.usr_id = ${33}
    ORDER BY ${sqlScore(db, "doc_view", { doc_id: sql`f.id` })} DESC, f.id
    LIMIT 3`;
  assertEquals(ids, [3, 2, 1]);
});

Deno.test("score: per user, by a key of more columns", async () => {
  await using db = await testDb();
  for (const id of [1, 2]) await db.exec`INSERT INTO doc (id, usr_id) VALUES (${id}, 33)`;
  await hit(db, "doc_usr", { usr_id: 7, doc_id: 1 });
  await hit(db, "doc_usr", { usr_id: 8, doc_id: 2 }, 3);
  await hit(db, "doc_usr", { usr_id: 8, doc_id: 1 });

  const top = (usr: number) => db.col<number>`SELECT id FROM doc d ORDER BY ${sqlScore(db, "doc_usr", { usr_id: usr, doc_id: sql`d.id` })} DESC, id`;
  assertEquals([await top(7), await top(8)], [[1, 2], [2, 1]]);

  await forget(db, "doc_usr", { usr_id: 8 }); // a part of the key: all its rows
  assertEquals(await db.col`SELECT usr_id FROM score_doc_usr`, [7]);
});

Deno.test("score: forget weakens or drops, prune deletes", async () => {
  await using db = await testDb();
  await hit(db, "doc_view", { doc_id: 1 }, 4);
  await forget(db, "doc_view", { doc_id: 1 }, 0.5);
  assert(Math.abs(strength(db, "doc_view", (await stored(db, 1))!) - 2) < 1e-6);

  await hit(db, "doc_view", { doc_id: 2 });
  await forget(db, "doc_view", { doc_id: 2 });
  assertEquals(await ranked(db), [1]);

  await forget(db, "doc_view", { doc_id: 1 }, 0.001); // 0.002 accesses left — below FORGET
  await hit(db, "doc_view", { doc_id: 3 });
  await prune(db);
  assertEquals(await ranked(db), [3]);
});

Deno.test("score: undeclared tables, wrong keys and negative weights are rejected", async () => {
  await using db = await testDb();
  assertThrows(() => hit(db, "page_view", { page_id: 1 }), Error, "No table");
  assertThrows(() => hit(db, "doc_usr", { doc_id: 1 }), Error, "key");
  assertThrows(() => sqlScore(db, "doc_view", { id: 1 }), Error, "key");
  assertThrows(() => hit(db, "doc_view", { doc_id: 1 }, 0), Error, "weight");
});

Deno.test("score: a deleted row loses its scores", async () => {
  await using db = await testDb();
  await db.exec`INSERT INTO doc (id, usr_id) VALUES (1, 33)`;
  await hit(db, "doc_view", { doc_id: 1 });
  await hit(db, "doc_usr", { usr_id: 7, doc_id: 1 });
  await db.table("doc").delete(1);

  assertEquals([await ranked(db), await db.col`SELECT doc_id FROM score_doc_usr`], [[], []]);
});
