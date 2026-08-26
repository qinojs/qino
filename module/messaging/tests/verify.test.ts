import { assertEquals, assertRejects } from "@std/assert";
import { ApiError, Db } from "@qino/qino";
import { authAttemptDbSchema } from "@qino/qino/tests";

import dbSchema from "../dbschema.json" with { type: "json" };
import { dropClaim, pendingContacts, redeemCode, requestCode } from "../mod.ts";

async function app() {
  const db = new Db("sqlite::memory:");
  await db.migrate({ properties: { ...dbSchema.properties, ...authAttemptDbSchema.properties } });
  await db.exec`CREATE TABLE usr (id INTEGER PRIMARY KEY AUTOINCREMENT)`;
  await db.loadTables();
  // deno-lint-ignore no-explicit-any
  return { db, settings: { core: { _secret: "test-secret" } } } as any;
}

Deno.test("a claim is proven by its code and spent either way it ends", async () => {
  const a = await app();
  const code = await requestCode(a, "email", 1, "one@qino.test");
  assertEquals((await pendingContacts(a, "email", 1)).map((c) => c.address), ["one@qino.test"]);

  await assertRejects(() => redeemCode(a, "email", 2, "one@qino.test", code), ApiError, "Nothing to verify");
  await assertRejects(() => redeemCode(a, "email", 1, "one@qino.test", "000000"), ApiError, "invalid");
  await redeemCode(a, "email", 1, "one@qino.test", code);
  assertEquals(await pendingContacts(a, "email", 1), []);
  await assertRejects(() => redeemCode(a, "email", 1, "one@qino.test", code), ApiError, "Nothing to verify");
});

Deno.test("an address receives one code at a time, and wrong codes buy a growing wait", async () => {
  const a = await app();
  const code = await requestCode(a, "phone", 1, "+41791234567");
  // the address is protected, not the claim: a second asker waits too, so nobody gets spammed
  await assertRejects(() => requestCode(a, "phone", 1, "+41791234567"), ApiError, "Wait before requesting");
  await assertRejects(() => requestCode(a, "phone", 2, "+41791234567"), ApiError, "Wait before requesting");

  for (let i = 0; i < 4; i++) await assertRejects(() => redeemCode(a, "phone", 1, "+41791234567", "000000"), ApiError, "invalid");
  // the claim survives — it is the account that has to wait, and the right code waits with it
  await assertRejects(() => redeemCode(a, "phone", 1, "+41791234567", "000000"), ApiError, "Too many attempts");
  await assertRejects(() => redeemCode(a, "phone", 1, "+41791234567", code), ApiError, "Too many attempts");
  assertEquals((await pendingContacts(a, "phone", 1)).length, 1);

  // kinds do not see each other's claims, and a kind checks what it is given
  await requestCode(a, "email", 2, "two@qino.test");
  assertEquals(String((await dropClaim(a, "email", 2, "two@qino.test"))?.usr_id), "2");
  await assertRejects(() => requestCode(a, "email", 2, "+41791234567"), ApiError, "email address");
});

Deno.test("a stranger's claim cannot lock the owner out of verifying their own address", async () => {
  const a = await app();
  await requestCode(a, "phone", 2, "+41791234567"); // whoever they are
  await a.db.table("usr_contact_verification").update({ type: "phone", address: "+41791234567", usr_id: 2 }, { sent: 1 });

  const mine = await requestCode(a, "phone", 1, "+41791234567"); // the owner, with a code of their own
  assertEquals((await pendingContacts(a, "phone", 1)).length, 1);
  assertEquals((await pendingContacts(a, "phone", 2)).length, 1);
  await redeemCode(a, "phone", 1, "+41791234567", mine);
  assertEquals(await pendingContacts(a, "phone", 1), []);
  assertEquals((await pendingContacts(a, "phone", 2)).length, 1); // theirs stands, and proves nothing
});

Deno.test("an expired claim is dropped and can be taken over", async () => {
  const a = await app();
  await requestCode(a, "phone", 1, "+41791234567");
  await a.db.table("usr_contact_verification").update({ type: "phone", address: "+41791234567", usr_id: 1 }, { expires: 1, sent: 1 });
  await requestCode(a, "phone", 2, "+41791234567");
  assertEquals((await pendingContacts(a, "phone", 1)).length, 0);
  assertEquals((await pendingContacts(a, "phone", 2)).length, 1);
});
