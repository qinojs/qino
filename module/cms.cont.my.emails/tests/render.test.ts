import { assertEquals, assertStringIncludes, fakeT } from "@qino/qino/tests";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name, dependencies } = manifest;

Deno.test("cms.cont.my.emails renders the signed-in email flow", async () => {
  assertEquals(name, "cms.cont.my.emails");
  assertEquals(dependencies, ["cms", "messaging.email"]);
  const node = { app: { t: fakeT } } as never;
  const output = String(await cms.node.render(node, { ctx: { user: {} } } as never));
  assertStringIncludes(output, "data-emails");
  assertStringIncludes(output, "type=email");
  assertStringIncludes(String(await cms.node.render(node, { ctx: {} } as never)), "Please sign in.");
});
