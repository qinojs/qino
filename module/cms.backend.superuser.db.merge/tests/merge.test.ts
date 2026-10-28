import { Db } from "@qino/qino";
import { assertEquals, assertRejects } from "@qino/qino/tests";

import { duplicates, merge, references } from "../lib/merge.ts";

/** People with orders, group memberships (keyed by person and group) and contacts. */
async function setup() {
  const db = new Db("sqlite::memory:");
  await db.exec`CREATE TABLE person (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, name TEXT, phone TEXT, log_id INTEGER)`;
  await db.exec`CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, person_id INTEGER, total INTEGER)`;
  await db.exec`CREATE TABLE member (person_id INTEGER, grp_id INTEGER, PRIMARY KEY (person_id, grp_id))`;
  db.schema = { properties: {
    orders: { additionalProperties: { properties: { person_id: { "x-qg-parent": "person" } } } },
    member: { additionalProperties: { properties: { person_id: { "x-qg-parent": "person", "x-qg-on-parent-delete": "cascade" } } } },
    person: { additionalProperties: { properties: { log_id: { "x-qg-parent": "log" } } } },
  } };
  await db.loadTables();
  await db.exec`INSERT INTO person (id, email, name, phone, log_id) VALUES
    (1, NULL, 'Anna Muster', '', NULL), (2, 'anna@example.test', 'Anna Muster', '079 1', 5),
    (3, NULL, 'Ben', NULL, NULL), (4, NULL, 'Ben', NULL, NULL), (5, NULL, '', NULL, NULL), (6, NULL, '', NULL, NULL)`;
  await db.exec`INSERT INTO orders (person_id, total) VALUES (1, 10), (2, 20), (2, 30)`;
  await db.exec`INSERT INTO member VALUES (1, 7), (2, 7), (2, 8)`;
  return db;
}

Deno.test("db.merge: rows equal in the chosen fields form groups, empty values never", async () => {
  const db = await setup();
  const groups = await duplicates(db, "person", ["name"]);
  assertEquals(groups.map((g) => g.map((r) => r.id)), [[1, 2], [3, 4]]); // 5 and 6 share only an empty name
  assertEquals((await duplicates(db, "person", ["name"], "id < 3")).length, 1);
  assertEquals((await references(db, "person", 2)).map((r) => `${r.field.table}.${r.field}:${r.count}`), ["orders.person_id:2", "member.person_id:2"]);
  await db.close();
});

Deno.test("db.merge: references move, a repeated membership goes, empty fields are filled", async () => {
  const db = await setup();
  const result = await merge(db, "person", 1, 2);
  assertEquals(result, { moved: { "orders.person_id": 2, "member.person_id": 1 }, dropped: 1, filled: ["email", "phone"] });
  assertEquals(await db.col`SELECT person_id FROM orders ORDER BY id`, [1, 1, 1]);
  assertEquals(await db.query`SELECT person_id, grp_id FROM member ORDER BY grp_id`, [{ person_id: 1, grp_id: 7 }, { person_id: 1, grp_id: 8 }]);
  // the unique email of the merged row is free once it is gone
  // its history (log_id) stays its own
  assertEquals(await db.row`SELECT email, name, phone, log_id FROM person WHERE id = 1`, { email: "anna@example.test", name: "Anna Muster", phone: "079 1", log_id: null });
  assertEquals(await db.one`SELECT COUNT(*) FROM person WHERE id = 2`, 0);
  await db.close();
});

Deno.test("db.merge: into itself or a missing row is refused, nothing changes", async () => {
  const db = await setup();
  await assertRejects(() => merge(db, "person", 1, 1));
  await assertRejects(() => merge(db, "person", 1, 99));
  assertEquals(await db.one`SELECT COUNT(*) FROM person`, 6);
  await db.close();
});
