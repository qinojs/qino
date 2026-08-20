// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals, assertRejects, assertThrows } from "./deps.ts";
import { Db } from "../lib/db/Db.ts";
import { DbRow } from "../lib/db/DbRow.ts";
import { Usr } from "../lib/rows.ts";

import coreSchema from "../dbschema.json" with { type: "json" };

class Order extends DbRow {
  declare id: number;
  declare title: string;
  declare time_ordered: number;
  declare note: string;
}

class ShopItem extends DbRow {
  declare title: string;
  declare time_ordered: number;
  place(): void {
    if (this.time_ordered) throw new Error("already ordered");
    this.time_ordered = 1700000000;
  }
}
const itemProps = {
  properties: {
    id: { type: "integer", "x-index": "primary", "x-autoincrement": true },
    title: { type: "string", maxLength: 191 },
    time_ordered: { type: "integer" },
  },
  required: ["id"],
};

const schema = {
  properties: {
    shop_item: { additionalProperties: itemProps },
    shop_order: {
      additionalProperties: {
        properties: {
          id: { type: "integer", "x-index": "primary", "x-autoincrement": true },
          title: { type: "string", maxLength: 191 },
          time_ordered: { type: "integer" },
          note: { type: "string", maxLength: 191 },
        },
        required: ["id"],
      },
    },
  },
};

async function testDb(): Promise<Db> {
  const db = new Db("sqlite::memory:");
  await db.migrate(schema, { patch: true });
  db.schema = schema;
  await db.loadTables();
  db.table("shop_order").rowClass = Order;
  db.table("shop_item").rowClass = ShopItem;
  return db;
}

Deno.test("DbRow: columns are accessors, writes batch into one UPDATE", async () => {
  await using db = await testDb();
  const updates: unknown[] = [];
  db.on("table:update-after", (e: any) => { updates.push(e.data); });
  const t = db.table("shop_order");
  await t.insert({ id: 1, title: "One", time_ordered: 0, note: "" });

  const order = (await t.get<Order>(1))!;
  assertEquals(order.title, "One");        // accessor, synchronous
  assertEquals(String(order), "1");

  order.title = "Two";                     // synchronous in memory
  order.note = "later";
  assertEquals(order.title, "Two");
  assert(order.$changed);

  await db.flush();
  assertEquals(updates, [{ title: "Two", note: "later" }]); // one write, both columns
  assertEquals(order.$changed, false);

  assertEquals((await db.row`SELECT title, note FROM shop_order WHERE id = 1`), { title: "Two", note: "later" });
});

Deno.test("DbRow: an unwritten change is flushed without being asked", async () => {
  await using db = await testDb();
  const t = db.table("shop_order");
  await t.insert({ id: 1, title: "One" });
  (await t.get<Order>(1))!.title = "auto";
  await new Promise((r) => setTimeout(r, 0)); // the microtask flush, nobody awaited it
  assertEquals(await db.one`SELECT title FROM shop_order WHERE id = 1`, "auto");
});

Deno.test("DbRow: same id gives the same object, so pending changes are shared", async () => {
  await using db = await testDb();
  const t = db.table("shop_order");
  await t.insert({ id: 1, title: "One" });
  const a = (await t.get<Order>(1))!;
  a.title = "changed";
  const b = (await t.get<Order>(1))!; // must not re-read over the pending change
  assertEquals(a, b);
  assertEquals(b.title, "changed");
});

Deno.test("DbRow: $read() writes pending changes before re-reading", async () => {
  await using db = await testDb();
  const t = db.table("shop_order");
  await t.insert({ id: 1, title: "One" });
  const order = (await t.get<Order>(1))!;
  order.title = "kept";
  await order.$read();
  assertEquals(order.title, "kept");
  assertEquals(await db.one`SELECT title FROM shop_order WHERE id = 1`, "kept");
});

Deno.test("DbRow: a write past the object invalidates it, the next get() re-reads", async () => {
  await using db = await testDb();
  const t = db.table("shop_order");
  await t.insert({ id: 1, title: "One" });
  const order = (await t.get<Order>(1))!;
  assertEquals(order.$stale, false);

  await t.update(1, { title: "from elsewhere" }); // no row object involved
  assert(order.$stale);
  assertEquals((await t.get<Order>(1))!.title, "from elsewhere");
  assertEquals(order.$stale, false);
});

Deno.test("DbRow: row TTL is configured per table and disabled by default", async () => {
  await using db = await testDb();
  const orders = db.table("shop_order");
  const items = db.table("shop_item");
  await orders.insert({ id: 1, title: "Order" });
  await items.insert({ id: 1, title: "Item" });
  const order = (await orders.get<Order>(1))!;
  const item = (await items.get<ShopItem>(1))!;

  orders.rowTtl = 1;
  await new Promise((r) => setTimeout(r, 5));
  assert(order.$stale);
  assertEquals(item.$stale, false);
  assertEquals(items.rowTtl, 0);
});

Deno.test("DbRow: a delete past the object marks it as gone", async () => {
  await using db = await testDb();
  const t = db.table("shop_order");
  await t.insert({ id: 1, title: "One" });
  const order = (await t.get<Order>(1))!;

  await t.delete(1);
  assertEquals(order.$exists, false);
  assertEquals(await t.get(1), undefined);
});

Deno.test("DbRow: $remove() and $exists", async () => {
  await using db = await testDb();
  const t = db.table("shop_order");
  await t.insert({ id: 1, title: "One" });
  const order = (await t.get<Order>(1))!;
  await order.$remove();
  assertEquals(order.$exists, false);
  assertEquals(await db.one`SELECT COUNT(*) FROM shop_order`, 0);
});

Deno.test("DbRow: add() returns a loaded row, all() maps a query", async () => {
  await using db = await testDb();
  const t = db.table("shop_order");
  const a = (await t.add<Order>({ title: "a" }))!;
  assert(a.$loaded);
  assertEquals(a.title, "a");
  assertEquals(a.note, null); // untouched column, its db value is only known after the re-read
  await t.add({ title: "b" });

  const rows = await t.all<Order>`WHERE title IN (${"a"}, ${"b"}) ORDER BY id`;
  assertEquals(rows.map((r) => r.title), ["a", "b"]);
  assertEquals(rows[0], a); // identity-mapped
  assertEquals(await t.all().then((r) => r.length), 2);
});

Deno.test("DbRow: a subclass carries behaviour, registered per table", async () => {
  await using db = await testDb();
  const t = db.table("shop_item");
  await t.insert({ id: 1, title: "One", time_ordered: 0 });
  const order = (await t.get<ShopItem>(1))!;
  assert(order instanceof ShopItem);
  order.place();
  assertThrows(() => order.place(), Error, "already ordered");
  await order.$save();
  assertEquals(await db.one`SELECT time_ordered FROM shop_item WHERE id = 1`, 1700000000);
});

Deno.test("DbRow: a member colliding with a column is refused, loudly", async () => {
  class Colliding extends DbRow {
    title(): string { return "shadowed"; }
  }
  const db = new Db("sqlite::memory:");
  const collideSchema = { properties: { collide_test: { additionalProperties: { properties: { id: { type: "integer", "x-index": "primary" }, title: { type: "string", maxLength: 20 } }, required: ["id"] } } } };
  await db.migrate(collideSchema, { patch: true });
  db.schema = collideSchema;
  await db.loadTables();
  db.table("collide_test").rowClass = Colliding;
  try {
    assertThrows(() => db.table("collide_test").row(1), Error, 'collides with a member');
  } finally {
    await db.close();
  }
});

Deno.test("DbRow: unknown columns are refused, JSON is the values", async () => {
  await using db = await testDb();
  const t = db.table("shop_order");
  await t.insert({ id: 1, title: "One", time_ordered: 0, note: "" });
  const order = (await t.get<Order>(1))!;
  assertThrows(() => order.$set("nope", 1), Error, "unknown column");
  assertEquals(JSON.parse(JSON.stringify(order)), { id: 1, title: "One", time_ordered: 0, note: "" });
  assertEquals(order.$keys, ["id", "title", "time_ordered", "note"]);
});

Deno.test("DbRow: $set(values) is the awaitable form", async () => {
  await using db = await testDb();
  const t = db.table("shop_order");
  await t.insert({ id: 1, title: "One" });
  const order = (await t.get<Order>(1))!;
  await order.$set({ title: "x", note: "y" });
  assertEquals(await db.row`SELECT title, note FROM shop_order WHERE id = 1`, { title: "x", note: "y" });
});

Deno.test("DbRow: a failed write keeps the values and the row dirty", async () => {
  const db = await testDb();
  try {
    const t = db.table("shop_order");
    await t.insert({ id: 1, title: "One" });
    const order = (await t.get<Order>(1))!;
    db.on("table:update-before", () => { throw new Error("denied"); });
    order.title = "attempt";
    await assertRejects(() => order.$save(), Error, "denied");
    assert(order.$changed);
    assertEquals(order.title, "attempt"); // nothing silently dropped
  } finally {
    await db.flush().catch(() => {}); // the queued retry, before the connection goes
    await db.close();
  }
});

Deno.test("DbRow: a second module must extend the class, it cannot replace it", async () => {
  await using db = await testDb();
  class Other extends DbRow {}
  assertThrows(() => { db.table("shop_order").rowClass = Other; }, Error, "must extend it");

  class Extended extends Order { extra() { return "ok"; } }
  db.table("shop_order").rowClass = Extended;
  await db.table("shop_order").insert({ id: 1, title: "One" });
  assertEquals((await db.table("shop_order").get<Extended>(1))!.extra(), "ok");
});

Deno.test("Db: tables stay reachable while loadTables runs", async () => {
  await using db = await testDb();
  // A session timer or a parallel request must not meet a half-introspected database, so the
  // check runs inside the introspection itself — waiting for a real overlap never interleaves.
  const columns = db.columns.bind(db);
  let missed = "";
  let calls = 0;
  (db as unknown as { columns: typeof columns }).columns = (table: string) => {
    calls++;
    try { db.table("shop_order"); } catch (e) { missed ||= (e as Error).message; }
    return columns(table);
  };
  await db.loadTables();
  assert(calls > 0);
  assertEquals(missed, "");
});

Deno.test("DbRow: a numeric column reads back as a number, whatever the driver hands over", async () => {
  await using db = await testDb();
  const t = db.table("shop_order");
  await t.insert({ id: 1, title: "One" });
  const row = (await t.get<Order>(1))!;
  row.$receive({ id: "1", title: "One", time_ordered: "1700000000.0000", note: "7" });
  assertEquals(row.id, 1);
  assertEquals(row.time_ordered, 1700000000);
  assertEquals(row.note, "7"); // a string column stays a string
});

Deno.test("DbTable.rowBy: a lookup by a non-key column lands in the identity map", async () => {
  await using db = await testDb();
  const t = db.table("shop_order");
  await t.insert({ id: 1, title: "One" });

  const found = await t.rowBy<Order>("title", "One");
  assertEquals(String(found), "1");
  assert(found === t.row<Order>(1)); // the object the map already holds, not a second one

  // written past the table layer, so nothing invalidates — the repeat lookup must not have asked
  await db.exec`UPDATE shop_order SET title = ${"Changed"} WHERE id = ${1}`;
  assertEquals((await t.rowBy<Order>("title", "One"))?.title, "One");

  await t.update(1, { title: "Renamed" }); // a write through the table does reach the handle
  assertEquals(await t.rowBy<Order>("title", "One"), undefined);
  assertEquals(String(await t.rowBy<Order>("title", "Renamed")), "1");
});

Deno.test("DbTable.rowBy: a value with no row is not remembered", async () => {
  await using db = await testDb();
  const t = db.table("shop_order");
  assertEquals(await t.rowBy("title", "Later"), undefined);
  await t.insert({ id: 1, title: "Later" }); // whoever missed inserts it — the next lookup has to see it
  assertEquals(String(await t.rowBy("title", "Later")), "1");
});

Deno.test("usr.contacts is the natural way in and out of usr_contact", async () => {
  const db = new Db("sqlite::memory:");
  await db.migrate({ properties: { usr: coreSchema.properties.usr, usr_contact: coreSchema.properties.usr_contact } });
  await db.loadTables();
  db.table("usr").rowClass = Usr;
  const usr = (await db.table("usr").add<Usr>({ email: "one@qino.test" }))!;

  await usr.contacts.add("email", "private@qino.test");
  await usr.contacts.add("email", "  Work@Qino.Test  "); // whitespace and case never make a second contact
  await usr.contacts.add("phone", "0041 79 123 45 67"); // and a kind that knows more says more
  assertEquals((await usr.contacts.list("email")).map((c) => [c.address, Boolean(c.main)]), [
    ["private@qino.test", true], // the first one of a kind becomes the main
    ["work@qino.test", false],
  ]);
  assertEquals((await usr.contacts.main("phone"))?.address, "+41791234567");

  await usr.contacts.setMain("email", "WORK@qino.test");
  assertEquals((await usr.contacts.main("email"))?.address, "work@qino.test");

  await usr.contacts.remove("email", "work@qino.test");
  assertEquals((await usr.contacts.main("email"))?.address, "private@qino.test"); // the flag moves on
  await db.close();
});
