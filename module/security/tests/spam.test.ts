import { unixTime } from "@qino/qino";
import { assert, assertEquals } from "@qino/qino/tests";

import { BLOCK, spamScore, suspicion } from "../mod.ts";
import { ctxOf, withApp } from "./app.ts";

import type { Ctx } from "@qino/qino";

// No ai in these apps: only the address's record and the client's age count.

Deno.test("spamScore: nothing known is clean", () => withApp(async (app) => {
  assertEquals(await spamScore(app, "Hello"), 0);
  assertEquals(await spamScore(app, { Message: "Hello" }, { ctx: ctxOf(app, "203.0.113.1") }), 0);
}));

Deno.test("spamScore: an address with a record is spam, whatever it sends", () => withApp(async (app) => {
  await app.fire("suspicious", { ctx: ctxOf(app, "203.0.113.2"), weight: BLOCK });
  assert(await spamScore(app, "Hello", { ctx: ctxOf(app, "203.0.113.2") }) > 0.99); // decays a little meanwhile
}));

Deno.test("spamScore: a brand-new client is likely a bot and is reported; a signed-in user is not", () => withApp(async (app) => {
  const client = Number(await app.db.table("client").insert({}));
  await app.db.table("log").insert({ client_id: client, time: unixTime() });
  const young = { ...ctxOf(app, "203.0.113.3"), clientId: client } as unknown as Ctx;
  assert(await spamScore(app, "Hello", { ctx: young }) > 0.9);
  assert(suspicion(app, "203.0.113.3") > 0, "and the address learns of it");
  const user = { ...ctxOf(app, "203.0.113.4"), clientId: client, userId: 1 } as unknown as Ctx;
  assertEquals(await spamScore(app, "Hello", { ctx: user }), 0);
}));
