// deno-lint-ignore-file no-explicit-any
import { html, u2Root } from "@qino/qino";
import { assertEquals, testContext } from "@qino/qino/tests";

import { cms, install } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name } = manifest;

Deno.test("cms.layout.system: metadata is wired", () => {
  assertEquals(name, "cms.layout.system");
  assertEquals(cms.node.css, ["pub/main.css"]);
});

Deno.test("cms.layout.system: render adds assets and wraps the main cont", async () => {
  const ctx = await testContext();

  const node = {
    title: () => ({ string: () => "Login" }),
    cont: (name: string) => name === "main" ? { html: () => html.raw("<form>Form</form>") } : null,
  };

  const out = String(await cms.node.render(node as any, { ctx }));
  assertEquals(out.includes("<h1>Login</h1>"), true);
  assertEquals(out.includes("<form>Form</form>"), true);
  assertEquals(ctx.res.html.styles.has(u2Root + "css/norm/norm.css"), true);
  assertEquals(ctx.res.html.styles.has("/m/cms/pub/css/ui.css"), true);
  assertEquals(ctx.res.html.scripts.has("/m/cms/pub/js/cms.mjs"), true);
});

Deno.test("cms.layout.system: install takes over the pages of cms.layout.login", async () => {
  let sql = "";
  const values: unknown[] = [];
  const uninstalled: string[] = [];
  const app = {
    db: { query: (parts: TemplateStringsArray, ...vs: unknown[]) => { sql = parts.join("?"); values.push(...vs); } },
    modules: { uninstall: (name: string) => Promise.resolve(void uninstalled.push(name)) },
  };

  await install({ app } as any);
  assertEquals(sql, "UPDATE page SET module = ? WHERE module = ?");
  assertEquals(values, ["cms.layout.system", "cms.layout.login"]);
  assertEquals(uninstalled, ["cms.layout.login"]);
});
