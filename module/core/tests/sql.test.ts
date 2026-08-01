import { assertEquals } from "./deps.ts";
import { Db } from "../lib/db/Db.ts";
import { sql } from "../deps.ts";

Deno.test("sql`` builds params, ids, raw and joins", () => {
  const f = sql`a = ${1} AND ${sql.id("b")} = ${2}`;
  assertEquals(f.parts, [
    { text: "a = " }, { param: 1 }, { text: " AND " }, { id: "b" }, { text: " = " }, { param: 2 },
  ]);
  assertEquals(sql.join([sql`${1}`, sql`${2}`]).parts, [{ param: 1 }, { text: ", " }, { param: 2 }]);
  assertEquals(sql.raw("DESC").parts, [{ text: "DESC" }]);
});

Deno.test("sql`` tag renders and runs (sqlite)", async () => {
  const db = new Db("sqlite::memory:");
  await db.query`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)`;
  await db.exec`INSERT INTO t (id, name) VALUES (${1}, ${"a"})`;
  await db.exec`INSERT INTO t (id, name) VALUES (${2}, ${"b"})`;

  // value → bound param
  assertEquals((await db.row`SELECT name FROM t WHERE id = ${2}`)?.name, "b");

  // sql.id (dynamic identifier) + sql.join (IN-list) + fragment composition
  const col = "name", ids = [1, 2];
  const frag = sql`SELECT ${sql.id(col)} FROM t WHERE id IN (${sql.join(ids.map((i) => sql`${i}`))}) ORDER BY id`;
  const rows = await db.query`${frag}`;
  assertEquals(rows.map((r) => r.name), ["a", "b"]);

  // direct method-tag form with an interpolated sql.id (LangManager shape)
  const idx = await db.indexCol`SELECT id, ${sql.id(col)} FROM t`;
  assertEquals(idx, { 1: "a", 2: "b" });
  await db.close();
});
