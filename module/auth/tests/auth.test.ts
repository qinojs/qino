import { assertEquals, assertRejects } from "@std/assert";

import { factors, proof } from "../mod.ts";

import type { App, Ctx } from "@qino/qino";

const passkey = { name: "webauthn", label: "Passkey", login: true, stepUp: true };
const social = { name: "oauth", label: "Social login", login: true };

const app = {
  modules: {
    linked: () => [
      { name: "webauthn", plugin: { authFactor: passkey } },
      { name: "oauth", plugin: { authFactor: social } },
      { name: "cms", plugin: {} },
    ],
  },
  // deno-lint-ignore no-explicit-any
} as any as App;

/** A request whose session records the stamps in `via`, so one is visible without a database. */
function ctx(userId: number, statelessAuth = false): Ctx & { via: Record<string, number> } {
  const via: Record<string, number> = {};
  const sess = { data: { core: { via: new Proxy({}, { get: (_t, name: string) => (at: number) => via[name] = at }) } } };
  // deno-lint-ignore no-explicit-any
  return { app, userId, statelessAuth, via, sess } as any;
}

Deno.test("only what a linked module declares is a factor", () => {
  assertEquals(factors(app), [passkey, social]);
});

Deno.test("proving the user you already are is a step-up, not a login", async () => {
  const c = ctx(7);
  assertEquals(await proof(c, "webauthn", 7), true);
  assertEquals(typeof c.via.webauthn, "number");
});

Deno.test("a factor may prove an identity without being allowed to refresh one", async () => {
  const c = ctx(7);
  assertEquals(await proof(c, "oauth", 7), false); // declares login, not stepUp
  assertEquals(c.via, {});
});

Deno.test("a stateless credential has no session to refresh", async () => {
  const c = ctx(7, true);
  assertEquals(await proof(c, "webauthn", 7), false);
  assertEquals(c.via, {});
});

Deno.test("an undeclared factor is a programming error, not a denial", async () => {
  await assertRejects(() => proof(ctx(7), "totp", 7), Error, 'no factor "totp"');
});
