// deno-lint-ignore-file no-explicit-any
import { assertEquals, testContext } from "../../core/tests/deps.ts";
import { cms, name } from "../plugin.ts";
import { u2Root } from "../../core/mod.ts";

Deno.test("cms.layout.login: metadata is wired", () => {
  assertEquals(name, "cms.layout.login");
  assertEquals(cms.node.css, ["pub/main.css"]);
});

Deno.test("cms.layout.login: render adds assets and wraps main content", async () => {
  const ctx = await testContext({ headers: { host: "example.test" } });

  const node = {
    title: () => ({ string: () => "Login" }),
    cont: (name: string) => name === "main" ? { html: () => "<form>Form</form>" } : null,
  };

  const out = await cms.node.render(node as any, { ctx });
  assertEquals(out.includes("<div id=title>Login</div>"), true);
  assertEquals(out.includes("<div id=subtitle>example.test</div>"), true);
  assertEquals(out.includes("<form>Form</form>"), true);
  assertEquals(ctx.html.meta.viewport, "width=device-width");
  assertEquals(ctx.html.styles.has(u2Root + "css/norm/norm.css"), true);
  assertEquals(ctx.html.legacyScripts.has("/m/core/pub/js/c1.js"), true);
  assertEquals(ctx.html.scripts.has("/m/cms/pub/js/cms.mjs"), true);
});
