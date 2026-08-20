import { createSessionGrant } from "@qino/qino";
import { assertEquals, testContext } from "@qino/qino/tests";

import { sign, check } from "../lib/sign.ts";

import type { Ctx } from "@qino/qino";

// One session, with the key slot sign() lazily fills.
function session(): Record<string, unknown> {
  let key = "";
  const item = (v?: string) => v === undefined ? key : (key = v);
  return { data: { core: { userId: () => 1, grantKey: item } } };
}

const ctxOf = (sess = session()): Promise<Ctx> => testContext({ sess });

const FILE = "/app/module/x/mod.ts";

Deno.test("fileEditor: a signature verifies for the file and session it was made for", async () => {
  const ctx = await ctxOf();
  const { exp, sig } = sign(ctx, FILE);
  assertEquals(check(ctx, FILE, exp, sig), "ok");
  assertEquals(check(ctx, "/app/module/x/other.ts", exp, sig), "forged");
});

Deno.test("fileEditor: another session cannot use the signature", async () => {
  const { exp, sig } = sign(await ctxOf(), FILE);
  assertEquals(check(await ctxOf(), FILE, exp, sig), "forged");
});

Deno.test("fileEditor: forged, missing and stretched signatures fail", async () => {
  const ctx = await ctxOf();
  const { exp, sig } = sign(ctx, FILE);
  assertEquals(check(ctx, FILE, exp, sig.slice(0, -1) + (sig.at(-1) === "a" ? "b" : "a")), "forged");
  assertEquals(check(ctx, FILE, exp, undefined), "forged");
  assertEquals(check(ctx, FILE, exp, ""), "forged");
  assertEquals(check(ctx, FILE, exp, sig + "="), "forged"); // length mismatch, no timingSafeEqual throw
  assertEquals(check(ctx, FILE, undefined, sig), "forged");
  assertEquals(check(ctx, FILE, undefined, undefined), "unsigned"); // a bare URL is not an attempt at forgery
});

Deno.test("fileEditor: an expired deadline is refused even with a correct mac", async () => {
  const ctx = await ctxOf();
  const fresh = createSessionGrant(ctx, "fileEditor", FILE, 10);
  const stale = createSessionGrant(ctx, "fileEditor", FILE, -10);
  assertEquals(check(ctx, FILE, fresh.exp, fresh.sig), "ok"); // the mac itself is right
  assertEquals(check(ctx, FILE, stale.exp, stale.sig), "expired"); // only the deadline says no
});

Deno.test("fileEditor: a non-numeric deadline never reaches the mac", async () => {
  const ctx = await ctxOf();
  const { exp, sig } = sign(ctx, FILE);
  for (const bad of ["1e12", " " + exp, exp + " ", "-1", "0x10", "99999999999999"]) {
    assertEquals(check(ctx, FILE, bad, sig), "forged", bad);
  }
});
