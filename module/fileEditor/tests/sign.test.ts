import { createHmac } from "node:crypto";
import { assertEquals, testContext } from "../../core/tests/deps.ts";
import { unixTime, type Ctx } from "../../core/mod.ts";
import { sign, check } from "../lib/sign.ts";

// deno-lint-ignore no-explicit-any
type Fake = Record<string, any>;

// One session, with the key slot sign() lazily fills.
function session(): Record<string, unknown> {
  let key = "";
  const item = (v?: string) => v === undefined ? key : (key = v);
  return { data: { core: { userId: () => 1 }, fileEditor: { key: item } } };
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
  const sess = session();
  const ctx = await ctxOf(sess);
  sign(ctx, FILE); // mints the session key
  const key = String((sess.data as Fake).fileEditor.key());
  const mac = (exp: number) => createHmac("sha256", key).update(`${FILE}\n${exp}`).digest("base64url").slice(0, 22);

  const past = unixTime() - 10, future = unixTime() + 10;
  assertEquals(check(ctx, FILE, String(future), mac(future)), "ok"); // the mac itself is right
  assertEquals(check(ctx, FILE, String(past), mac(past)), "expired"); // only the deadline says no
});

Deno.test("fileEditor: a non-numeric deadline never reaches the mac", async () => {
  const ctx = await ctxOf();
  const { exp, sig } = sign(ctx, FILE);
  for (const bad of ["1e12", " " + exp, exp + " ", "-1", "0x10", "99999999999999"]) {
    assertEquals(check(ctx, FILE, bad, sig), "forged", bad);
  }
});
