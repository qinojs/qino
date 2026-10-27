import { assertEquals, assertStringIncludes, fakeT, testContext } from "@qino/qino/tests";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name, dependencies } = manifest;

Deno.test("cms.cont.my.webauthn renders the signed-in passkey list", async () => {
  assertEquals(name, "cms.cont.my.webauthn");
  assertEquals(dependencies, ["cms", "auth.webauthn", "u2"]);
  const node = { app: { t: fakeT } } as never;
  const ctx = await testContext({ url: "http://qino.test/site/", appUrl: "/site/", set: { user: {} } });
  const output = String(await cms.node.render(node, { ctx } as never));
  assertStringIncludes(output, "data-keys");
  assertStringIncludes(output, `data-api-base="/site/api/auth.webauthn"`);
  assertStringIncludes(String(await cms.node.render(node, { ctx: {} } as never)), "Please sign in.");
});
