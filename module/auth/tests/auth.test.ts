import { assertEquals, assertRejects } from "@std/assert";

import { factors, proof } from "../mod.ts";

import type { App, Ctx } from "@qino/qino";

const passkey = { name: "webauthn", label: "Passkey", stepUp: true };
const social = { name: "oauth", label: "External login" };
const codes = { name: "backup_codes", label: "Backup codes", second: true, stepUp: true };

const app = {
  modules: {
    linked: () => [
      { name: "webauthn", plugin: { authFactors: [passkey] } },
      { name: "oauth", plugin: { authFactors: [social] } },
      { name: "auth.backup_codes", plugin: { authFactors: [codes] } },
      { name: "cms", plugin: {} },
    ],
  },
  // deno-lint-ignore no-explicit-any
} as any as App;

/** A request whose session records the stamps in `via`, so one is visible without a database. */
function ctx(userId: number, statelessAuth = false): Ctx & { via: Record<string, number> } {
  const via: Record<string, number> = {};
  let pending: unknown;
  const sess = {
    data: {
      core: {
        via: new Proxy({}, { get: (_t, name: string) => (at: number) => via[name] = at }),
        pending: (v?: unknown) => v === undefined ? pending : (pending = v),
      },
    },
  };
  // deno-lint-ignore no-explicit-any
  return { app, userId, statelessAuth, via, sess } as any;
}

Deno.test("only what a linked module declares is a factor", () => {
  assertEquals(factors(app).map((f) => f.name), ["webauthn", "oauth", "backup_codes"]);
  assertEquals(factors(app).map((f) => f.module), ["webauthn", "oauth", "auth.backup_codes"]);
});

Deno.test("proving the user you already are is a step-up, not a login", async () => {
  const c = ctx(7);
  assertEquals(await proof(c, "webauthn", 7), undefined); // nothing missing
  assertEquals(typeof c.via.webauthn, "number");
});

Deno.test("a factor may prove an identity without being allowed to refresh one", async () => {
  const c = ctx(7);
  assertEquals(await proof(c, "oauth", 7), []); // declares login, not stepUp: nothing here helps
  assertEquals(c.via, {});
});

Deno.test("a stateless credential has no session to refresh", async () => {
  const c = ctx(7, true);
  assertEquals(await proof(c, "webauthn", 7), []);
  assertEquals(c.via, {});
});

Deno.test("a factor that cannot stand alone starts no login", async () => {
  const c = ctx(0); // nobody signed in, and no login under way to complete
  assertEquals(await proof(c, "backup_codes", 7), []);
  assertEquals(c.sess.data.core.pending(), undefined);
});

Deno.test("an undeclared factor is a programming error, not a denial", async () => {
  await assertRejects(() => proof(ctx(7), "totp", 7), Error, 'no factor "totp"');
});
