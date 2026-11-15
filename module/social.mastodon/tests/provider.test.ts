import { test } from "node:test";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { ProviderError } from "@qino/qino/social";

import { socialProvider } from "../mod.ts";

const app = (url = "", accessToken = "") => ({ settings: { "social.mastodon": { url, accessToken } } }) as never;

test("social.mastodon stays dormant without an account; a wrong setup is final, not retried", async () => {
  assertEquals(await socialProvider.targets(app()), []);
  for (const [url, token, message] of [["", "", "configure url"], ["http://social.test", "t", "HTTPS"], ["https://u:p@social.test", "t", "credentials"]]) {
    const error = await assertRejects(() => socialProvider.publish(app(url, token), "1", "Hello", "k"), Error, message);
    assert(!(error instanceof ProviderError), message);
  }
});
