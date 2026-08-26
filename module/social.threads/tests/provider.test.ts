import { assertEquals, assertRejects } from "@std/assert";

import { socialProvider } from "../mod.ts";

const app = (accessToken = "") => ({ settings: { "social.threads": { accessToken } } }) as never;

Deno.test("social.threads stays dormant without an account and validates before publishing", async () => {
  assertEquals(socialProvider.name, "threads");
  assertEquals(await socialProvider.targets(app()), []);
  await assertRejects(() => socialProvider.publish(app(), "1", "", "qino-social-1"), Error, "text is empty");
  await assertRejects(() => socialProvider.publish(app(), "1", "Hello", "qino-social-1"), Error, "configure accessToken");
});
