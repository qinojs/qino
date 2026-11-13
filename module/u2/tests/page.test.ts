import { test } from "node:test";
import { html, Output } from "@qino/qino";
import { assert, assertEquals, assertStringIncludes, testContext } from "@qino/qino/tests";

import { page } from "../mod.ts";

test("u2.page: a system view of its own — no index, no referrer, and it stands without identity", async () => {
  const ctx = await testContext({ url: "http://qino.test/messaging/unsubscribe/x" });
  const thrown = await page(ctx, "Unsubscribe", html`<p>Done.</p>`, { status: 404 }).catch((e) => e);
  assert(thrown instanceof Output, "ends the route");
  assertEquals(ctx.res.status, 404);
  assertEquals(ctx.res.html.title, "Unsubscribe");
  assertEquals(ctx.res.html.meta.robots, "noindex, nofollow");
  assertEquals(ctx.res.headers.get("Referrer-Policy"), "no-referrer");
  assertStringIncludes(ctx.res.html.content, "<main><h1>Unsubscribe</h1><p>Done.</p></main>");
});
