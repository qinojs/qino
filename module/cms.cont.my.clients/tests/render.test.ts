import { assertEquals, assertStringIncludes, fakeT } from "@qino/qino/tests";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name, dependencies } = manifest;

Deno.test("cms.cont.my.clients renders signed-in state", async () => {
  assertEquals(name, "cms.cont.my.clients");
  assertEquals(dependencies, ["cms"]);

  const node = { app: { t: fakeT } } as never;
  const output = String(await cms.node.render(node, { ctx: { user: {}, userId: 7 } } as never));
  assertStringIncludes(output, "Active clients");
  assertStringIncludes(output, "Device");
  assertStringIncludes(output, "Location");

  const loggedOut = String(await cms.node.render(node, { ctx: {} } as never));
  assertStringIncludes(loggedOut, "Please sign in.");
});
