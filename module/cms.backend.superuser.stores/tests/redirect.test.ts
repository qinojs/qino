import { Redirect } from "@qino/qino";
import { assertRejects } from "@qino/qino/tests";

import { cms } from "../plugin.ts";

Deno.test("the former store page redirects to module administration", async () => {
  const page = { url: () => "/backend/superuser/module" };
  const node = { cms: { nodeByModule: () => ({ page: () => page }) } };
  await assertRejects(() => cms.node.render(node as never), Redirect);
});
