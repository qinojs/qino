import { Db } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

import { messagingChannel } from "../plugin.ts";
import dbSchema from "../dbschema.json" with { type: "json" };

async function app() {
  const db = new Db("sqlite::memory:");
  await db.migrate(dbSchema);
  await db.loadTables();
  const sub = (id: number, clientId: number) =>
    db.table("webpush_subscription").insert({
      id,
      usr_id: 7,
      client_id: clientId,
      endpoint: `https://push.test/${id}`,
      endpoint_hash: `hash${id}`,
      p256dh: "k",
      auth: "a",
      created: 1,
    });
  await sub(1, 100); // the browser the request comes from
  await sub(2, 200);
  // deno-lint-ignore no-explicit-any
  return { db } as any;
}

Deno.test("webpush: the asking device does not count as a way to reach someone", async () => {
  const a = await app();
  assertEquals(await messagingChannel.reach(a, 7), 2);
  assertEquals(await messagingChannel.reach(a, 7, 100), 1);
  assertEquals(await messagingChannel.reach(a, 7, "100"), 1); // clientId is a string on the request
  assertEquals(await messagingChannel.reach(a, 8, 100), 0);
  await a.db.close();
});
