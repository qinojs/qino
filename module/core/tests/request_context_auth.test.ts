// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "./deps.ts";
import { RequestContext } from "../lib/ctx/RequestContext.ts";

function sessionFake(sessionUserId: number) {
  const writes: unknown[][] = [];
  const data = { core: { userId: (...a: unknown[]) => { if (a.length) writes.push(a); return sessionUserId; } } };
  return { sess: { data } as any, writes };
}

Deno.test("RequestContext: userId falls back to the cookie session", () => {
  const ctx = new RequestContext();
  ctx.sess = sessionFake(5).sess;

  assertEquals(ctx.userId, 5);
  assertEquals(ctx.statelessAuth, false);
});

Deno.test("RequestContext: authenticate beats the session and never writes it", () => {
  const ctx = new RequestContext();
  const { sess, writes } = sessionFake(5);
  ctx.sess = sess;

  ctx.authenticate(7);
  assertEquals(ctx.userId, 7);
  assertEquals(ctx.statelessAuth, true);
  assertEquals(writes.length, 0);
});
