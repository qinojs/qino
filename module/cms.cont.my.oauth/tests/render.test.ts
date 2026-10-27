import { assertEquals, assertStringIncludes, fakeT, testContext } from "@qino/qino/tests";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name, dependencies } = manifest;

Deno.test("cms.cont.my.oauth lists the connect links of configured providers", async () => {
  assertEquals(name, "cms.cont.my.oauth");
  assertEquals(dependencies, ["cms", "auth.oauth", "u2"]);
  const app = { t: fakeT, db: { query: () => Promise.resolve([{ name: "github" }]) } };
  const ctx = await testContext({ url: "http://qino.test/site/my", appUrl: "/site/", set: { user: {} } });
  const output = String(await cms.node.render({ app } as never, { ctx } as never));
  assertStringIncludes(output, "data-links");
  assertStringIncludes(output, "oauth/start/github?return_to=%2Fsite%2Fmy");
  assertStringIncludes(String(await cms.node.render({ app } as never, { ctx: {} } as never)), "Please sign in.");
});
