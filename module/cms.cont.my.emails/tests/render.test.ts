import { assertEquals, assertStringIncludes, fakeT, testContext } from "@qino/qino/tests";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name, dependencies } = manifest;

Deno.test("cms.cont.my.emails renders the signed-in email flow", async () => {
  assertEquals(name, "cms.cont.my.emails");
  assertEquals(dependencies, ["cms", "messaging.email", "u2"]);
  const node = { app: { t: fakeT }, settings: {} } as never;
  const output = String(await cms.node.render(node, { ctx: await testContext({ set: { user: {} } }) } as never));
  assertStringIncludes(output, "data-emails");
  assertStringIncludes(output, "type=email");
  assertStringIncludes(String(await cms.node.render(node, { ctx: {} } as never)), "Please sign in.");
  assertStringIncludes(output, "Add email address");
  const single = { app: { t: fakeT }, settings: { single: true } } as never;
  const replacing = String(await cms.node.render(single, { ctx: await testContext({ set: { user: {} } }) } as never));
  assertStringIncludes(replacing, "data-single");
  assertStringIncludes(replacing, "Set email address");
});
