import { assert, assertEquals, assertThrows } from "../../core/tests/deps.ts";
import { Db, unixTime } from "../../core/mod.ts";
import { forget, hit, prune, scored, sqlScore, strength } from "../mod.ts";
import { cron, dbSchema, name, needs } from "../plugin.ts";

const DAY = 86400;

const ranked = (db: Db) => db.col<number>`SELECT id FROM score WHERE tbl = 'doc' ORDER BY score DESC`;

async function testDb(): Promise<Db> {
  const db = new Db("sqlite:");
  await db.migrate(dbSchema);
  await db.exec`CREATE TABLE doc (id INTEGER PRIMARY KEY AUTOINCREMENT, usr_id INTEGER)`;
  scored(db).doc = 30 * DAY;
  return db;
}

Deno.test("score: metadata is wired", () => {
  assertEquals(name, "score");
  assertEquals(needs, ["core", "cron"]);
  assertEquals(cron.prune.every, "day");
});

Deno.test("score: hits accumulate and rank", async () => {
  const db = await testDb();
  await hit(db, "doc", 1);
  await hit(db, "doc", 2);
  await hit(db, "doc", 2);
  await hit(db, "doc", 3, 5);

  assertEquals(await ranked(db), [3, 2, 1]);
  const score = await db.one<number>`SELECT score FROM score WHERE tbl = 'doc' AND id = 2`;
  assert(Math.abs(strength(db, "doc", score!) - 2) < 1e-6);
  await db.close();
});

Deno.test("score: recency beats a stale majority", async () => {
  const db = await testDb();
  const now = unixTime();
  const rate = Math.LN2 / (30 * DAY);
  // 10 accesses 180 days ago (6 half-lives → 0.16) vs. one access today
  await db.exec`INSERT INTO score (tbl, id, score, time) VALUES ('doc', 1, ${rate * (now - 180 * DAY) + Math.log(10)}, ${now - 180 * DAY})`;
  await hit(db, "doc", 2);

  assertEquals(await ranked(db), [2, 1]);
  assert(Math.abs(strength(db, "doc", (await db.one<number>`SELECT score FROM score WHERE id = 1`)!) - 10 / 64) < 1e-6);
  await db.close();
});

Deno.test("score: sqlScore orders a joined query and keeps unscored rows last", async () => {
  const db = await testDb();
  for (const id of [1, 2, 3, 4]) await db.exec`INSERT INTO doc (id, usr_id) VALUES (${id}, 33)`;
  await db.exec`INSERT INTO doc (id, usr_id) VALUES (9, 34)`;
  await hit(db, "doc", 2);
  await hit(db, "doc", 3);
  await hit(db, "doc", 3);
  await hit(db, "doc", 9);

  const ids = await db.col<number>`
    SELECT f.id FROM doc f
    WHERE f.usr_id = ${33}
    ORDER BY ${sqlScore("doc", "f.id")} DESC, f.id
    LIMIT 3`;
  assertEquals(ids, [3, 2, 1]);

  // without an alias the default "<tbl>.id" applies
  assertEquals(await db.col<number>`SELECT id FROM doc ORDER BY ${sqlScore("doc")} DESC, id LIMIT 2`, [3, 2]);
  await db.close();
});

Deno.test("score: forget weakens or drops, prune deletes", async () => {
  const db = await testDb();
  await hit(db, "doc", 1, 4);
  await forget(db, "doc", 1, 0.5);
  assert(Math.abs(strength(db, "doc", (await db.one<number>`SELECT score FROM score WHERE id = 1`)!) - 2) < 1e-6);

  await hit(db, "doc", 2);
  await forget(db, "doc", 2);
  assertEquals(await ranked(db), [1]);

  await forget(db, "doc", 1, 0.001); // 0.002 accesses left — below FORGET
  await hit(db, "doc", 3);
  await prune(db);
  assertEquals(await ranked(db), [3]);
  await db.close();
});

Deno.test("score: unregistered tables and negative weights are rejected", async () => {
  const db = await testDb();
  assertThrows(() => hit(db, "page", 1), Error, "not scored");
  assertThrows(() => hit(db, "doc", 1, 0), Error, "weight");

  const long = "d".repeat(33);
  scored(db)[long] = 30 * DAY;
  assertThrows(() => hit(db, long, 1), Error, "32 characters");
  await db.close();
});
