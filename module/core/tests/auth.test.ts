import { assertEquals } from "../../../deps.ts";
import { pwHash, pwNeedsRehash, pwVerify } from "../lib/auth.ts";

Deno.test("auth: pwNeedsRehash accepts bcrypt variants only", () => {
  assertEquals(pwNeedsRehash("$2a$10$abcdefghijklmnopqrstuuuuuuuuuuuuuuuuuuuuuuuuuuuuu"), false);
  assertEquals(pwNeedsRehash("$2b$10$abcdefghijklmnopqrstuuuuuuuuuuuuuuuuuuuuuuuuuuuuu"), false);
  assertEquals(pwNeedsRehash("$2y$10$abcdefghijklmnopqrstuuuuuuuuuuuuuuuuuuuuuuuuuuuuu"), false);
  assertEquals(pwNeedsRehash("plain"), true);
  assertEquals(pwNeedsRehash(""), true);
});

Deno.test("auth: pwHash and pwVerify roundtrip", async () => {
  const hash = await pwHash("secret");
  assertEquals(await pwVerify("secret", hash), true);
  assertEquals(await pwVerify("wrong", hash), false);
  assertEquals(await pwVerify("", hash), false);
  assertEquals(await pwVerify("secret", ""), false);
});

Deno.test("auth: pwVerify accepts PHP $2y$ bcrypt hashes", async () => {
  const hash = await pwHash("legacy");
  const phpHash = hash.replace(/^\$2b\$/, "$2y$");
  assertEquals(await pwVerify("legacy", phpHash), true);
});
