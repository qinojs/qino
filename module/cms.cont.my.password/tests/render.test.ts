import { assertEquals, assertStringIncludes, fakeT } from "@qino/qino/tests";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name, dependencies } = manifest;

Deno.test("cms.cont.my.password renders the change form for the signed-in user", async () => {
  assertEquals(name, "cms.cont.my.password");
  assertEquals(dependencies, ["cms"]);
  const node = { app: { t: fakeT } } as never;
  const output = String(await cms.node.render(node, { ctx: { user: { username: "one@qino.test" } } } as never));
  assertStringIncludes(output, "autocomplete=new-password");
  assertStringIncludes(output, `value="one@qino.test"`);
  assertStringIncludes(String(await cms.node.render(node, { ctx: {} } as never)), "Please sign in.");
});
