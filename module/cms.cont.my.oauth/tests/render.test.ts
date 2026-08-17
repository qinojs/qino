import { assertEquals, assertStringIncludes, fakeT } from "@qino/qino/tests";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name, dependencies } = manifest;

Deno.test("cms.cont.my.oauth lists the connect links of configured providers", async () => {
  assertEquals(name, "cms.cont.my.oauth");
  assertEquals(dependencies, ["cms", "auth.oauth"]);
  const app = { t: fakeT, db: { query: () => Promise.resolve([{ name: "github" }]) } };
  const ctx = { user: {}, req: { appUrl: "/site/", url: { pathname: "/site/my", search: "" } } };
  const output = String(await cms.node.render({ app } as never, { ctx } as never));
  assertStringIncludes(output, "data-links");
  assertStringIncludes(output, "oauth/start/github?return_to=%2Fsite%2Fmy");
  assertStringIncludes(String(await cms.node.render({ app } as never, { ctx: {} } as never)), "Please sign in.");
});
