// deno-lint-ignore-file no-explicit-any
import { html } from "@qino/qino";
import { cms as quote } from "@qino/qino/cms.cont.quote.cd";
import { cms as section3 } from "@qino/qino/cms.cont.section3";
import { assertEquals, assertStringIncludes } from "@qino/qino/tests";

// A site without its own data/<module>/index.ts falls back to the module's own shell.
const fakeNode = (settings: Record<string, unknown>) => ({
  module: { data: "/nowhere/", name: "test" },
  settings: new Proxy(settings, { get: (s, k: string) => s[k] }),
  file: () => ({ exists: () => false }),
  cont: (name: string) => ({ html: () => html.raw(`<div>${name}</div>`) }),
  showText: (name: string) => `text:${name}`,
});

const render = (mod: any, settings: Record<string, unknown>) => mod.node.render(fakeNode(settings) as any, {} as any).then(String);

Deno.test("cms.cont.section3: the settings reach the shell, not just the site template", async () => {
  assertEquals(await render(section3, {}), "<section><div>main</div></section>");

  const dark = await render(section3, { "background-color": "#222222" });
  assertStringIncludes(dark, "background-color:#222222;");
  assertStringIncludes(dark, "color:#fff;"); // dark background switches the text

  assertStringIncludes(await render(section3, { "background white": true }), "background-color:#fff;");
  assertStringIncludes(await render(section3, { "font white": true }), "color:#fff;");
  assertStringIncludes(await render(section3, { fixed: true }), "<section class=-Fix>");
});

Deno.test("cms.cont.quote.cd: heading level renders the title, zero hides it", async () => {
  assertEquals(await render(quote, { heading: 0 }), "<section><div>main</div></section>");
  assertStringIncludes(await render(quote, { heading: 3 }), "<h3>text:title</h3>");
  assertStringIncludes(await render(quote, { "background-color": "#fff" }), `style="background-color:#fff;"`);
});
