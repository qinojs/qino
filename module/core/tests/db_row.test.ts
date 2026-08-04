// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals, assertRejects, assertThrows } from "./deps.ts";
import { Db } from "../lib/db/Db.ts";
import { DbRow } from "../lib/db/DbRow.ts";

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
  const db = await testDb();
  const updates: unknown[] = [];
  db.on("table:update-after", (e: any) => { updates.push(e.data); });
  try {
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
  } finally {
    await db.close();
  }
});

Deno.test("DbRow: an unwritten change is flushed without being asked", async () => {
  const db = await testDb();
  try {
    const t = db.table("shop_order");
    await t.insert({ id: 1, title: "One" });
    (await t.get<Order>(1))!.title = "auto";
    await new Promise((r) => setTimeout(r, 0)); // the microtask flush, nobody awaited it
    assertEquals(await db.one`SELECT title FROM shop_order WHERE id = 1`, "auto");
  } finally {
    await db.close();
  }
});

Deno.test("DbRow: same id gives the same object, so pending changes are shared", async () => {
  const db = await testDb();
  try {
    const t = db.table("shop_order");
    await t.insert({ id: 1, title: "One" });
    const a = (await t.get<Order>(1))!;
    a.title = "changed";
    const b = (await t.get<Order>(1))!; // must not re-read over the pending change
    assertEquals(a, b);
    assertEquals(b.title, "changed");
  } finally {
    await db.close();
  }
});

Deno.test("DbRow: $read() writes pending changes before re-reading", async () => {
  const db = await testDb();
  try {
    const t = db.table("shop_order");
    await t.insert({ id: 1, title: "One" });
    const order = (await t.get<Order>(1))!;
    order.title = "kept";
    await order.$read();
    assertEquals(order.title, "kept");
    assertEquals(await db.one`SELECT title FROM shop_order WHERE id = 1`, "kept");
  } finally {
    await db.close();
  }
});

Deno.test("DbRow: a write past the object invalidates it, the next get() re-reads", async () => {
  const db = await testDb();
  try {
    const t = db.table("shop_order");
    await t.insert({ id: 1, title: "One" });
    const order = (await t.get<Order>(1))!;
    assertEquals(order.$stale, false);

    await t.update(1, { title: "from elsewhere" }); // no row object involved
    assert(order.$stale);
    assertEquals((await t.get<Order>(1))!.title, "from elsewhere");
    assertEquals(order.$stale, false);
  } finally {
    await db.close();
  }
});

Deno.test("DbRow: a delete past the object marks it as gone", async () => {
  const db = await testDb();
  try {
    const t = db.table("shop_order");
    await t.insert({ id: 1, title: "One" });
    const order = (await t.get<Order>(1))!;

    await t.delete(1);
    assertEquals(order.$exists, false);
    assertEquals(await t.get(1), undefined);
  } finally {
    await db.close();
  }
});

Deno.test("DbRow: $remove() and $exists", async () => {
  const db = await testDb();
  try {
    const t = db.table("shop_order");
    await t.insert({ id: 1, title: "One" });
    const order = (await t.get<Order>(1))!;
    await order.$remove();
    assertEquals(order.$exists, false);
    assertEquals(await db.one`SELECT COUNT(*) FROM shop_order`, 0);
  } finally {
    await db.close();
  }
});

Deno.test("DbRow: add() returns a loaded row, all() maps a query", async () => {
  const db = await testDb();
  try {
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
  } finally {
    await db.close();
  }
});

Deno.test("DbRow: a subclass carries behaviour, registered per table", async () => {
  const db = await testDb();
  try {
    const t = db.table("shop_item");
    await t.insert({ id: 1, title: "One", time_ordered: 0 });
    const order = (await t.get<ShopItem>(1))!;
    assert(order instanceof ShopItem);
    order.place();
    assertThrows(() => order.place(), Error, "already ordered");
    await order.$save();
    assertEquals(await db.one`SELECT time_ordered FROM shop_item WHERE id = 1`, 1700000000);
  } finally {
    await db.close();
  }
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
  const db = await testDb();
  try {
    const t = db.table("shop_order");
    await t.insert({ id: 1, title: "One", time_ordered: 0, note: "" });
    const order = (await t.get<Order>(1))!;
    assertThrows(() => order.$set("nope", 1), Error, "unknown column");
    assertEquals(JSON.parse(JSON.stringify(order)), { id: 1, title: "One", time_ordered: 0, note: "" });
    assertEquals(order.$keys, ["id", "title", "time_ordered", "note"]);
  } finally {
    await db.close();
  }
});

Deno.test("DbRow: $set(values) is the awaitable form", async () => {
  const db = await testDb();
  try {
    const t = db.table("shop_order");
    await t.insert({ id: 1, title: "One" });
    const order = (await t.get<Order>(1))!;
    await order.$set({ title: "x", note: "y" });
    assertEquals(await db.row`SELECT title, note FROM shop_order WHERE id = 1`, { title: "x", note: "y" });
  } finally {
    await db.close();
  }
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
  const db = await testDb();
  try {
    class Other extends DbRow {}
    assertThrows(() => { db.table("shop_order").rowClass = Other; }, Error, "must extend it");

    class Extended extends Order { extra() { return "ok"; } }
    db.table("shop_order").rowClass = Extended;
    await db.table("shop_order").insert({ id: 1, title: "One" });
    assertEquals((await db.table("shop_order").get<Extended>(1))!.extra(), "ok");
  } finally {
    await db.close();
  }
});
