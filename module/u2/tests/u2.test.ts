import { assertEquals } from "@qino/qino/tests";

import { elements } from "../mod.ts";

import type { Ctx } from "@qino/qino";

Deno.test("u2.elements allows what an element fetches itself, and nothing for an element without", () => {
  const ctx = { res: { csp: { "script-src": {}, "style-src": {} } } } as unknown as Ctx;
  elements(ctx, "code", "button");
  const hljs = "https://cdn.jsdelivr.net/gh/highlightjs/";
  assertEquals(ctx.res.csp["script-src"], { [hljs]: true });
  assertEquals(ctx.res.csp["style-src"], { [hljs]: true });
});
