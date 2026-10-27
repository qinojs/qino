import { assertEquals, assertStringIncludes, fakeT, testContext } from "@qino/qino/tests";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name, dependencies } = manifest;

Deno.test("cms.cont.my.phones renders the signed-in phone flow", async () => {
  assertEquals(name, "cms.cont.my.phones");
  assertEquals(dependencies, ["cms", "messaging.sms", "u2"]);
  const node = { app: { t: fakeT }, settings: {} } as never;
  const output = String(await cms.node.render(node, { ctx: await testContext({ set: { user: {} } }) } as never));
  assertStringIncludes(output, "data-phones");
  assertStringIncludes(output, "type=tel");
  assertStringIncludes(String(await cms.node.render(node, { ctx: {} } as never)), "Please sign in.");
  assertStringIncludes(output, "Add phone number");
  const single = { app: { t: fakeT }, settings: { single: true } } as never;
  const replacing = String(await cms.node.render(single, { ctx: await testContext({ set: { user: {} } }) } as never));
  assertStringIncludes(replacing, "data-single");
  assertStringIncludes(replacing, "Set phone number");
});
