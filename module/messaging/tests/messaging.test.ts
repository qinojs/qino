import { assertEquals } from "@std/assert";
import dbSchema from "../dbschema.json" with { type: "json" };
import { messages, msgOf, record, titleOf, userMessages } from "../mod.ts";
import { Db, type App } from "../../core/mod.ts";

async function app(): Promise<App> {
  const db = new Db("sqlite::memory:");
  await db.migrate(dbSchema);
  await db.exec`CREATE TABLE usr (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL)`;
  await db.exec`CREATE TABLE grp (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`;
  await db.exec`CREATE TABLE log (id INTEGER PRIMARY KEY AUTOINCREMENT)`;
  await db.loadTables();
  db.schema = dbSchema;
  return { db } as App;
}

Deno.test("messaging stores one logical message with recipient deliveries", async () => {
  const testApp = await app();
  await testApp.db.exec`INSERT INTO usr (email) VALUES ('one@example.test'), ('two@example.test')`;
  await testApp.db.exec`INSERT INTO grp (name) VALUES ('Editors')`;
  const id = await record(testApp, {
    channel: "sms",
    direction: "out",
    grpId: 1,
    data: { text: "Hello" },
    time: 10,
  }, [
    { usrId: 1, time: 11 },
    { usrId: 2, error: "rejected", time: 12 },
  ]);

  assertEquals(id, 1);
  assertEquals(await messages(testApp), [{
    id: 1,
    channel: "sms",
    direction: "out",
    grp_id: 1,
    grp_name: "Editors",
    log_id: null,
    data: '{"text":"Hello"}',
    time: 10,
    recipient_count: 2,
    deliveries: [
      { id: 1, usr_id: 1, address: null, email: "one@example.test", time: 11, error: null },
      { id: 2, usr_id: 2, address: null, email: "two@example.test", time: 12, error: "rejected" },
    ],
  }]);

  assertEquals(await userMessages(testApp, 2), [{
    id: 1,
    channel: "sms",
    direction: "out",
    grp_id: 1,
    grp_name: "Editors",
    log_id: null,
    data: '{"text":"Hello"}',
    time: 10,
    recipient_count: 2,
    deliveries: [
      { id: 2, usr_id: 2, address: null, email: "two@example.test", time: 12, error: "rejected" },
    ],
  }]);
  assertEquals(await userMessages(testApp, 3), []);
});

Deno.test("a bare string is a message, and a missing title is its first line", () => {
  assertEquals(msgOf("Hello"), { text: "Hello" });
  assertEquals(msgOf({ text: "Hello", title: "Hi" }), { text: "Hello", title: "Hi" });

  assertEquals(titleOf({ text: "Hello", title: "Hi" }), "Hi");
  assertEquals(titleOf({ text: "  Your order shipped.\nIt arrives tomorrow." }), "Your order shipped.");
  assertEquals(titleOf({ text: "a".repeat(40) + " " + "b".repeat(40) }), "a".repeat(40) + "…");
  assertEquals(titleOf({ text: "x".repeat(100) }), "x".repeat(78) + "…");
});
