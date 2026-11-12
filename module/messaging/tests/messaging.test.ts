import { test } from "node:test";
import { assertEquals } from "@std/assert";
import { journal, userJournal } from "@qino/qino/tests";
import { Db, sql } from "@qino/qino";

import dbSchema from "../dbschema.json" with { type: "json" };
import { msgOf, record, release, titleOf } from "../mod.ts";

import type { App } from "@qino/qino";

async function app() {
  const db = new Db("sqlite::memory:");
  await db.migrate(dbSchema);
  await db.exec`CREATE TABLE usr (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL)`;
  await db.exec`CREATE TABLE grp (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`;
  await db.exec`CREATE TABLE log (id INTEGER PRIMARY KEY AUTOINCREMENT)`;
  await db.exec`CREATE TABLE file (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, mime TEXT, size INTEGER)`;
  await db.loadTables();
  db.schema = dbSchema;
  return { db } as App;
}

test("messaging stores one logical message with recipient deliveries", async () => {
  const testApp = await app();
  await testApp.db.exec`INSERT INTO usr (username) VALUES ('one@example.test'), ('two@example.test')`;
  await testApp.db.exec`INSERT INTO grp (name) VALUES ('Editors')`;
  const { id, ids } = await record(testApp, {
    channel: "sms",
    direction: "out",
    grpId: 1,
    msg: { title: "Greeting", text: "Hello" },
    data: { to: { grp: 1 } },
    time: 10,
  }, [
    { usrId: 1, sent: 11 },
    { usrId: 2, error: "rejected", sent: 12 },
  ]);

  assertEquals(id, 1);
  assertEquals(ids, [1, 2]); // a tracked link needs the delivery's own id before anything is sent
  assertEquals(await journal(testApp), [{
    id: 1,
    channel: "sms",
    direction: "out",
    grp_id: 1,
    grp_name: "Editors",
    log_id: null,
    title: "Greeting",
    text: "Hello",
    format: null,
    template: null,
    data: '{"to":{"grp":1}}',
    time: 10,
    spam: null,
    recipient_count: 2,
    attachments: [],
    deliveries: [
      { id: 1, usr_id: 1, address: null, username: "one@example.test", sent: 11, due: null, attempts: 0, error: null },
      { id: 2, usr_id: 2, address: null, username: "two@example.test", sent: 12, due: null, attempts: 0, error: "rejected" },
    ],
  }]);

  assertEquals(await userJournal(testApp, 2), [{
    id: 1,
    channel: "sms",
    direction: "out",
    grp_id: 1,
    grp_name: "Editors",
    log_id: null,
    title: "Greeting",
    text: "Hello",
    format: null,
    template: null,
    data: '{"to":{"grp":1}}',
    time: 10,
    spam: null,
    recipient_count: 2,
    attachments: [],
    deliveries: [
      { id: 2, usr_id: 2, address: null, username: "two@example.test", sent: 12, due: null, attempts: 0, error: "rejected" },
    ],
  }]);
  assertEquals(await userJournal(testApp, 3), []);
});

test("a bare string is a message, and a missing title is its first line", () => {
  assertEquals(msgOf("Hello"), { text: "Hello" });
  assertEquals(msgOf({ text: "Hello", title: "Hi" }), { text: "Hello", title: "Hi" });

  assertEquals(titleOf({ text: "Hello", title: "Hi" }), "Hi");
  assertEquals(titleOf({ text: "  Your order shipped.\nIt arrives tomorrow." }), "Your order shipped.");
  assertEquals(titleOf({ text: "a".repeat(40) + " " + "b".repeat(40) }), "a".repeat(40) + "…");
  assertEquals(titleOf({ text: "x".repeat(100) }), "x".repeat(78) + "…");
});

test("a draft has no deliveries until released; a later due leaves it to the outbox", async () => {
  const testApp = await app();
  for (const column of ["given_name", "family_name", "organization"]) await testApp.db.exec`ALTER TABLE usr ADD COLUMN ${sql.id(column)} TEXT`;
  const delivered: number[] = [];
  const channel = {
    name: "sms",
    recipients: () => Promise.resolve([{ address: "+41790000001", usrId: 1 }, { address: "bad", addressError: "not a number" }]),
    deliver: (_app: App, rows: { id: unknown }[]) => (delivered.push(...rows.map((row) => Number(row.id))), Promise.resolve(rows.length)),
  };
  Object.assign(testApp, { url: () => Promise.resolve("https://qino.test/"), modules: { linked: () => [{ plugin: { messagingChannel: channel } }] } });
  const draft = async () => (await record(testApp, { channel: "sms", direction: "out", msg: "Hello", data: { to: { grp: 1 } }, time: 1 })).id;

  const now = await draft();
  assertEquals(await release(testApp, now), 1);
  assertEquals(delivered, [1], "the undeliverable address is finished, not sent");
  assertEquals(await testApp.db.col`SELECT error FROM message_delivery ORDER BY id`, [null, "not a number"]);
  assertEquals(await release(testApp, now).then(() => "sent twice", (e) => e.message), "messaging: message 1 was released already");

  const later = await draft();
  const due = Math.floor(Date.now() / 1000) + 3600;
  assertEquals(await release(testApp, later, due), 0);
  assertEquals(await testApp.db.col`SELECT due FROM message_delivery WHERE message_id = ${later} AND error IS NULL`, [due]);
  assertEquals(await testApp.db.one`SELECT time FROM message WHERE id = ${later}`, due, "the journal's time is when it goes out");
  assertEquals(delivered, [1]);
});
