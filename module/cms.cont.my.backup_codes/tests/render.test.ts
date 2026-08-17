import { assertEquals, assertStringIncludes, fakeT } from "@qino/qino/tests";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name, dependencies } = manifest;

Deno.test("cms.cont.my.backup_codes renders the signed-in shell", async () => {
  assertEquals(name, "cms.cont.my.backup_codes");
  assertEquals(dependencies, ["cms", "auth.backup_codes"]);
  const node = { app: { t: fakeT } } as never;
  const output = String(await cms.node.render(node, { ctx: { user: {} } } as never));
  assertStringIncludes(output, "data-state");
  assertStringIncludes(output, "data-generate");
  assertStringIncludes(String(await cms.node.render(node, { ctx: {} } as never)), "Please sign in.");
});
