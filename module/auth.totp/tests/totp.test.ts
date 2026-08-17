import { assert, assertEquals, assertFalse } from "@std/assert";

import { at, secret, uri, valid } from "../lib/totp.ts";

// RFC 6238 appendix B: the ASCII secret "12345678901234567890" is base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ.
const RFC = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

Deno.test("totp: matches the RFC 6238 test vectors", async () => {
  assertEquals(await at(RFC, Math.floor(59 / 30)), "287082");
  assertEquals(await at(RFC, Math.floor(1111111109 / 30)), "081804");
  assertEquals(await at(RFC, Math.floor(1234567890 / 30)), "005924");
});

Deno.test("totp: the current code is accepted, a wrong one is not", async () => {
  const s = secret();
  const now = Math.floor(Date.now() / 1000 / 30);
  assert(await valid(s, await at(s, now)));
  assert(await valid(s, await at(s, now - 1)), "one step back is within the drift tolerance");
  assertFalse(await valid(s, await at(s, now - 5)));
  assertFalse(await valid(s, "000"));
  assertFalse(await valid(s, "abcdef"));
});

Deno.test("totp: a fresh secret is base32 and the uri carries what an app needs", () => {
  const s = secret();
  assertEquals(s.length, 32); // 20 bytes
  assert(/^[A-Z2-7]+$/.test(s));

  const u = new URL(uri(s, "ann@example.test", "qino.example"));
  assertEquals(u.protocol, "otpauth:");
  assertEquals(u.searchParams.get("secret"), s);
  assertEquals(u.searchParams.get("issuer"), "qino.example");
  assertEquals(u.searchParams.get("digits"), "6");
  assertEquals(u.host, "totp");
  assertEquals(decodeURIComponent(u.pathname), "/qino.example:ann@example.test");
});
