import { assertEquals } from "@qino/qino/tests";

import { assets, elements, root } from "../mod.ts";

import type { Ctx } from "@qino/qino";

Deno.test("u2.elements allows what an element fetches itself, and nothing for an element without", () => {
  const ctx = { res: { csp: { "script-src": {}, "style-src": {} } } } as unknown as Ctx;
  elements(ctx, "code", "button");
  const hljs = "https://cdn.jsdelivr.net/gh/highlightjs/";
  assertEquals(ctx.res.csp["script-src"], { [hljs]: true });
  assertEquals(ctx.res.csp["style-src"], { [hljs]: true });
});

Deno.test("u2.assets without a version follows the page's @u2/, else qino's", () => {
  const page = () => ({
    res: {
      csp: { "script-src": {}, "style-src": {}, "connect-src": {} },
      html: { importMap: new Map(), scripts: new Set(), styles: new Set() },
    },
  }) as unknown as Ctx;
  const plain = page();
  assets(plain, ["el/alert/alert.js"]);
  assertEquals([...plain.res.html.scripts], [root() + "el/alert/alert.js"]);
  const site = page();
  site.res.html.importMap.set("@u2/", root("1.5.19"));
  assets(site, ["el/alert/alert.js", "el/alert/alert.css"]);
  assertEquals([...site.res.html.scripts], [root("1.5.19") + "el/alert/alert.js"]);
  assertEquals([...site.res.html.styles], [root("1.5.19") + "el/alert/alert.css"]);
});
