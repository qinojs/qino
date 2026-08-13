import { assertRejects } from "@qino/qino/tests";
import { Redirect } from "@qino/qino";
import { cms } from "../plugin.ts";

Deno.test("the former own-store page redirects to own modules", async () => {
  const page = { url: () => "/backend/superuser/module/own-store" };
  const node = { cms: { nodeByModule: () => ({ page: () => page }) } };
  await assertRejects(() => cms.node.render(node as never), Redirect);
});
