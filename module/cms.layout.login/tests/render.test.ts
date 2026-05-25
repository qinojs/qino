// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "../../core/tests/deps.ts";
import { cms, name } from "../mod.ts";
import { RequestContext } from "../../core/lib/RequestContext.ts";

Deno.test("cms.layout.login: metadata is wired", () => {
  assertEquals(name, "cms.layout.login");
  assertEquals(cms.node.css, ["pub/main.css"]);
});

Deno.test("cms.layout.login: render adds assets and wraps main content", async () => {
  const ctx = new RequestContext();
  ctx.sysURL = "/m/";
  ctx.req = { header: (name: string) => name === "host" ? "example.test" : "" } as any;

  const node = {
    title: () => ({ string: () => "Login" }),
    cont: (name: string) => name === "main" ? { html: () => "<form>Form</form>" } : null,
  };

  const out = await cms.node.render(node as any, { ctx });
  assertEquals(out.includes("<div id=title>Login</div>"), true);
  assertEquals(out.includes("<div id=subtitle>example.test</div>"), true);
  assertEquals(out.includes("<form>Form</form>"), true);
  assertEquals(ctx.html.meta.viewport, "width=device-width");
  assertEquals(ctx.html.styles.has("https://cdn.jsdelivr.net/gh/u2ui/u2@1.3.5/css/norm/norm.css"), true);
  assertEquals(ctx.html.legacyScripts.has("/m/core/pub/js/c1.js"), true);
  assertEquals(ctx.html.scripts.has("/m/cms/pub/js/cms.mjs"), true);
});
