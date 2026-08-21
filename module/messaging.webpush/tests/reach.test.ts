import { generateVAPIDKeys } from "web-push-neo";
import { b64url, Db, randB64 } from "@qino/qino";
import { assertEquals, messagingDbSchema } from "@qino/qino/tests";

import { messagingChannel } from "../plugin.ts";
import dbSchema from "../dbschema.json" with { type: "json" };
import { send } from "../mod.ts";

import type { App } from "@qino/qino";

async function app() {
  const db = new Db("sqlite::memory:");
  await db.migrate({ properties: { ...messagingDbSchema.properties, ...dbSchema.properties } });
  await db.query`CREATE TABLE usr (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, firstname TEXT, lastname TEXT, company TEXT)`;
  await db.query`CREATE TABLE usr_grp (usr_id INTEGER, grp_id INTEGER)`;
  await db.loadTables();
  const key = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const p256dh = b64url(new Uint8Array(await crypto.subtle.exportKey("raw", key.publicKey)));
  const sub = (id: number, clientId: number, usrId = 7) =>
    db.table("webpush_subscription").insert({
      id,
      usr_id: usrId,
      client_id: clientId,
      endpoint: `https://push.test/${id}`,
      endpoint_hash: `hash${id}`,
      p256dh,
      auth: randB64(16),
      created: 1,
    });
  await sub(1, 100); // the browser the request comes from
  await sub(2, 200);
  const vapid = await generateVAPIDKeys();
  return {
    db,
    settings: { messaging: { _secret: "test-secret" }, "messaging.webpush": { subject: "mailto:admin@qino.test", ...vapid } },
    url: () => Promise.resolve("https://qino.test/"),
    modules: { linked: () => [] },
  } as unknown as App;
}

Deno.test("webpush: the asking device does not count as a way to reach someone", async () => {
  const a = await app();
  assertEquals(await messagingChannel.reach(a, 7), 2);
  assertEquals(await messagingChannel.reach(a, 7, 100), 1);
  assertEquals(await messagingChannel.reach(a, 7, "100"), 1); // clientId is a string on the request
  assertEquals(await messagingChannel.reach(a, 8, 100), 0);
  await a.db.close();
});

Deno.test("webpush: subscription and client arrays add to user selection without duplicates", async () => {
  const a = await app();
  const table = a.db.table("webpush_subscription");
  const keys = await a.db.row`SELECT p256dh, auth FROM webpush_subscription WHERE id = ${1}`;
  const first = await table.insert({ ...keys, id: 3, usr_id: 8, client_id: 300, endpoint: "https://push.test/3", endpoint_hash: "hash3", created: 1 });
  const second = await table.insert({ ...keys, id: 4, usr_id: 8, client_id: 400, endpoint: "https://push.test/4", endpoint_hash: "hash4", created: 1 });
  const calls: string[] = [];
  const fetch = globalThis.fetch;
  globalThis.fetch = (input) => (calls.push(String(input)), Promise.resolve(new Response("", { status: 201 })));
  try {
    assertEquals(await send(a, { usr: 7, sub: [Number(first), Number(second)], client: [300, "400"] }, "Hello"), 4);
    assertEquals(calls.sort(), [1, 2, 3, 4].map((id) => `https://push.test/${id}`));
  } finally {
    globalThis.fetch = fetch;
    await a.db.close();
  }
});
