// deno-lint-ignore-file no-explicit-any
import { assertEquals, testContext } from "./deps.ts";

function sessionFake(sessionUserId: number) {
  const writes: unknown[][] = [];
  const data = { core: { userId: (...a: unknown[]) => { if (a.length) writes.push(a); return sessionUserId; } } };
  return { sess: { data } as any, writes };
}

Deno.test("Ctx: userId falls back to the cookie session", async () => {
  const ctx = await testContext({ sess: sessionFake(5).sess });

  assertEquals(ctx.userId, 5);
  assertEquals(ctx.statelessAuth, false);
});

Deno.test("Ctx: authenticate beats the session and never writes it", async () => {
  const { sess, writes } = sessionFake(5);
  const ctx = await testContext({ sess });

  ctx.authenticate(7);
  assertEquals(ctx.userId, 7);
  assertEquals(ctx.statelessAuth, true);
  assertEquals(writes.length, 0);
});
