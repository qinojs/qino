import { test } from "node:test";
import { ResHtml } from "@qino/qino";
import { assertEquals } from "@qino/qino/tests";

import { assets, pin, root } from "../mod.ts";

import type { Ctx } from "@qino/qino";

test("u2.assets load the page's release: the pinned one, else qino's — wherever the pin comes", () => {
  const page = () => ({ res: { csp: { "script-src": {}, "style-src": {}, "connect-src": {} }, html: new ResHtml() } }) as unknown as Ctx;
  const plain = page();
  assets(plain, ["el/alert/alert.js"]);
  plain.res.html.resolve();
  assertEquals([...plain.res.html.scripts], [root() + "el/alert/alert.js"]);

  const site = page();
  assets(site, ["el/alert/alert.js", "el/alert/alert.css"]); // a content before the layout
  pin(site, "1.5.19");
  site.res.html.resolve();
  assertEquals([...site.res.html.scripts], [root("1.5.19") + "el/alert/alert.js"]);
  assertEquals([...site.res.html.styles], [root("1.5.19") + "el/alert/alert.css"]);
  assertEquals(site.res.csp["script-src"][root("1.5.19")], true);
});
