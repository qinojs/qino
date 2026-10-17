import { assertStringIncludes, fakeT } from "@qino/qino/tests";

import { cms } from "../plugin.ts";

Deno.test("cms.cont.fin.my.credit: a frame the browser fills, for signed-in users only", async () => {
  const node = { app: { t: fakeT } } as never;
  assertStringIncludes(String(await cms.node.render(node, { ctx: { user: {} } } as never)), "data-credit");
  assertStringIncludes(String(await cms.node.render(node, { ctx: { user: null } } as never)), "Please sign in.");
});
