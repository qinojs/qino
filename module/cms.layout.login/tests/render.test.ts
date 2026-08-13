// deno-lint-ignore-file no-explicit-any
import { html, u2Root } from "@qino/qino";
import { assertEquals, testContext } from "@qino/qino/tests";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name } = manifest;

Deno.test("cms.layout.login: metadata is wired", () => {
  assertEquals(name, "cms.layout.login");
  assertEquals(cms.node.css, ["pub/main.css"]);
});

Deno.test("cms.layout.login: render adds assets and wraps main content", async () => {
  const ctx = await testContext({ headers: { host: "example.test" } });

  const node = {
    title: () => ({ string: () => "Login" }),
    cont: (name: string) => name === "main" ? { html: () => html.raw("<form>Form</form>") } : null,
  };

  const out = String(await cms.node.render(node as any, { ctx }));
  assertEquals(out.includes("<div id=title>Login</div>"), true);
  assertEquals(out.includes("<div id=subtitle>example.test</div>"), true);
  assertEquals(out.includes("<form>Form</form>"), true);
  assertEquals(ctx.res.html.meta.viewport, "width=device-width");
  assertEquals(ctx.res.html.styles.has(u2Root + "css/norm/norm.css"), true);
  assertEquals(ctx.res.html.scripts.has("/m/cms/pub/js/cms.mjs"), true);
});
