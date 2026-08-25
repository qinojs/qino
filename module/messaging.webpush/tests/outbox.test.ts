import { generateVAPIDKeys } from "web-push-neo";
import { b64url, Db, randB64 } from "@qino/qino";
import { assert, assertEquals, messagingDbSchema } from "@qino/qino/tests";

import { outbox } from "@qino/qino/messaging";

import dbSchema from "../dbschema.json" with { type: "json" };
import { messagingChannel, send } from "../mod.ts";

import type { App } from "@qino/qino";

async function app() {
  const db = new Db("sqlite::memory:");
  await db.migrate({ properties: { ...messagingDbSchema.properties, ...dbSchema.properties } });
  await db.query`CREATE TABLE usr (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, given_name TEXT, family_name TEXT, organization TEXT)`;
  await db.query`CREATE TABLE usr_grp (usr_id INTEGER, grp_id INTEGER)`;
  await db.loadTables();
  const key = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  await db.table("webpush_subscription").insert({
    usr_id: 7,
    client_id: 100,
    endpoint: "https://push.test/1",
    endpoint_hash: "hash1",
    p256dh: b64url(new Uint8Array(await crypto.subtle.exportKey("raw", key.publicKey))),
    auth: randB64(16),
    created: 1,
  });
  const vapid = await generateVAPIDKeys();
  return {
    db,
    settings: { messaging: { _secret: "test-secret" }, "messaging.webpush": { subject: "mailto:admin@qino.test", ...vapid } },
    url: () => Promise.resolve("https://qino.test/"),
    modules: { linked: () => [{ plugin: { messagingChannel } }] },
  } as unknown as App;
}

/** Answer the push service gives, one per call. */
function pushService(answers: number[]) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (input) => {
    calls.push(String(input));
    return Promise.resolve(new Response("", { status: answers[calls.length - 1] ?? 201 }));
  };
  return { calls, restore: () => globalThis.fetch = original };
}

Deno.test("webpush: a push service having a bad day is retried, and the notification survives it", async () => {
  const a = await app();
  const service = pushService([503]);
  try {
    assertEquals(await send(a, { usr: 7 }, { text: "Hello", title: "Hi", url: "/news", icon: "/icon.png" }), 0);
    const [held] = await a.db.query`SELECT * FROM message_delivery`;
    assertEquals(held.sent, null);
    assertEquals(held.attempts, 1);
    assert(Number(held.due) > 0, "owed again");
    // ours, not the endpoint's: the subscription is left alone
    assertEquals(await a.db.one`SELECT error FROM webpush_subscription`, null);
    // what only webpush understands is the journal's too, so the retry is the same notification
    assertEquals(JSON.parse(String(await a.db.one`SELECT data FROM message`)).msg, { url: "/news", icon: "/icon.png" });

    await a.db.exec`UPDATE message_delivery SET due = ${1}`;
    assertEquals(await outbox(a), 1);
    assertEquals(service.calls, ["https://push.test/1", "https://push.test/1"]);
    const [done] = await a.db.query`SELECT * FROM message_delivery`;
    assertEquals(done.due, null);
    assertEquals(done.error, null);
    assert(Number(done.sent) > 0, "went out");
  } finally {
    service.restore();
    await a.db.close();
  }
});

Deno.test("webpush: a subscription the browser dropped meanwhile is final, not owed", async () => {
  const a = await app();
  const service = pushService([503]);
  try {
    await send(a, { usr: 7 }, "Hello");
    await a.db.exec`UPDATE message_delivery SET due = ${1}`;
    await a.db.exec`DELETE FROM webpush_subscription`;
    assertEquals(await outbox(a), 0);
    const [gone] = await a.db.query`SELECT * FROM message_delivery`;
    assertEquals(gone.due, null);
    assert(String(gone.error).includes("gone"), "the journal says why");
  } finally {
    service.restore();
    await a.db.close();
  }
});
