import { assertEquals, assertRejects } from "@std/assert";
import { ApiError, Db } from "../../core/mod.ts";
import dbSchema from "../dbschema.json" with { type: "json" };
import { check, issue, redeem, type Ticket, type TicketKind } from "../mod.ts";

const passwords: string[] = [];

// how a consumer writes a handler: the payload it was issued with, plus what the redeemer brings
function setPassword(_app: unknown, t: Ticket, input?: unknown): number {
  return passwords.push(`${(t.data as { usrId: number }).usrId}:${(input as { pw: string }).pw}`);
}

const kinds: Record<string, TicketKind> = {
  "auth.resetPw": { ttl: 3600, redeem: setPassword },
  "mail.unsubscribe": { ttl: null },
  "cms.share": { uses: 2 },
};

async function app() {
  const db = new Db("sqlite::memory:");
  await db.migrate(dbSchema);
  await db.loadTables();
  return {
    db,
    settings: { ticket: { _secret: "test-secret" } },
    modules: { all: () => ({ test: { name: "test", plugin: { tickets: kinds } } }), linked: () => true },
    // deno-lint-ignore no-explicit-any
  } as any;
}

Deno.test("knowing the handle is the whole proof, and redeeming spends it", async () => {
  const a = await app();
  const handle = await issue(a, "auth.resetPw", { usrId: 7 });
  assertEquals((await check(a, handle))?.purpose, "auth.resetPw");

  await redeem(a, handle, { pw: "new" });
  assertEquals(passwords, ["7:new"]);
  assertEquals(await check(a, handle), undefined);
  assertEquals(await a.db.one`SELECT used FROM ticket WHERE purpose = ${"auth.resetPw"}`, 1);
  await assertRejects(() => redeem(a, handle), ApiError, "Nothing to redeem");
});

Deno.test("looking does not spend — a mail scanner opening the link costs nothing", async () => {
  const a = await app();
  const handle = await issue(a, "auth.resetPw", { usrId: 1 });
  for (let i = 0; i < 3; i++) await check(a, handle);
  assertEquals(await a.db.one`SELECT COUNT(*) FROM ticket`, 1);
});

Deno.test("a kind decides how long and how often", async () => {
  const a = await app();
  const share = await issue(a, "cms.share", { page: 410 });
  assertEquals((await redeem(a, share) as { data: unknown }).data, { page: 410 }); // no handler: the ticket itself
  await redeem(a, share);
  await assertRejects(() => redeem(a, share), ApiError, "Nothing to redeem");

  const forever = await issue(a, "mail.unsubscribe", { email: "one@qino.test" });
  assertEquals(await a.db.one`SELECT expires FROM ticket WHERE purpose = ${"mail.unsubscribe"}`, null);
  assertEquals((await check(a, forever))?.expires, undefined);
});

Deno.test("expired and spent tickets stop working but stay on record", async () => {
  const a = await app();
  const handle = await issue(a, "auth.resetPw", { usrId: 1 });
  await a.db.exec`UPDATE ticket SET expires = 1`;
  assertEquals(await check(a, handle), undefined);
  assertEquals(await a.db.one`SELECT COUNT(*) FROM ticket`, 1); // kept as a record, the cron sweeps it after a year
});

Deno.test("the handle is never stored, and an unregistered purpose is a mistake", async () => {
  const a = await app();
  const handle = await issue(a, "auth.resetPw", { usrId: 1 });
  assertEquals(await a.db.one`SELECT hash FROM ticket WHERE hash = ${handle}`, undefined);
  await assertRejects(() => issue(a, "auth.rest"), Error, 'no kind "auth.rest"');
});
