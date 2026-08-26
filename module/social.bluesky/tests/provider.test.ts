import { assertEquals, assertMatch, assertNotEquals, assertRejects } from "@std/assert";

import { tid } from "../lib/tid.ts";
import { socialProvider } from "../mod.ts";

const app = (settings: Record<string, unknown> = {}) => ({ settings: { "social.bluesky": settings } }) as never;

Deno.test("social.bluesky stays dormant without an account and validates before calling the PDS", async () => {
  assertEquals(socialProvider.name, "bluesky");
  assertEquals(await socialProvider.targets(app()), []);
  await assertRejects(() => socialProvider.publish(app(), "did:plc:qino", "", "qino-social-1"), Error, "text is empty");
  await assertRejects(
    () => socialProvider.targets(app({ url: "http://bsky.test", handle: "qino.test", appPassword: "xxxx-xxxx-xxxx-xxxx" })),
    Error,
    "must use HTTPS",
  );
});

Deno.test("social.bluesky maps a retry key to a stable valid TID", async () => {
  const key = await tid("qino-social-5");
  assertMatch(key, /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/);
  assertEquals(await tid("qino-social-5"), key);
  assertNotEquals(await tid("qino-social-6"), key);
});
