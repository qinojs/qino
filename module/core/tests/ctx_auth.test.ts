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

/** Authenticate against an app that records which hash names the client and the session. */
async function authenticated(userId: number, device: string) {
  const { sess, writes } = sessionFake(5);
  const seen: { client?: string; sess?: string; pinned?: boolean } = {};
  const app = {
    db: { table: () => ({ rowBy: () => undefined, add: async ({ hash }: any) => (seen.client = hash, { addUsr: async () => {}, toString: () => "3" }) }) },
    sessions: { load: (token: string, pinned: boolean) => (Object.assign(seen, { sess: token, pinned }), { token }) },
  };
  const ctx = await testContext({ sess, app });
  await ctx.authenticate(userId, device);
  return { ctx, seen, writes };
}

Deno.test("Ctx: authenticate beats the cookie session and never writes it", async () => {
  const { ctx, writes } = await authenticated(7, "api_key:1");
  assertEquals(ctx.userId, 7);
  assertEquals(ctx.statelessAuth, true);
  assertEquals(writes.length, 0);
});

Deno.test("Ctx: a credential's device is one client and one pinned session, named by a secret hash", async () => {
  const { ctx, seen } = await authenticated(7, "api_key:1");
  assertEquals(ctx.clientId, "3");
  assertEquals(seen.client?.length, 22);
  assertEquals(seen.sess, seen.client);
  assertEquals(seen.pinned, true);
  assertEquals((await authenticated(7, "api_key:1")).seen.client, seen.client);
  assertEquals((await authenticated(7, "api_key:2")).seen.client === seen.client, false);
  assertEquals((await authenticated(8, "api_key:1")).seen.client === seen.client, false);
});
