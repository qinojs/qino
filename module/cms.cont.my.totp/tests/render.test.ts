import { assertEquals, assertStringIncludes, fakeT, testContext } from "@qino/qino/tests";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name, dependencies } = manifest;

Deno.test("cms.cont.my.totp renders the signed-in enrolment flow", async () => {
  assertEquals(name, "cms.cont.my.totp");
  assertEquals(dependencies, ["cms", "auth.totp", "u2"]);
  const ctx = await testContext();
  const node = { app: { t: fakeT } } as never;
  const signedIn = Object.create(ctx, { user: { value: {} } }); // ctx.user is a getter
  const output = String(await cms.node.render(node, { ctx: signedIn } as never));
  assertStringIncludes(output, "data-apps");
  assertStringIncludes(output, "data-start");
  const qrcode = [...ctx.res.html.scripts].find((s) => s.endsWith("el/qrcode/qrcode.js"))!;
  assertEquals(ctx.res.csp["script-src"][qrcode.replace("el/qrcode/qrcode.js", "")], true);
  assertStringIncludes(String(await cms.node.render(node, { ctx: {} } as never)), "Please sign in.");
});
