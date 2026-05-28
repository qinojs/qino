// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "./deps.ts";
import { HtmlBuilder } from "../lib/HtmlBuilder.ts";
import { RequestContext } from "../lib/RequestContext.ts";

function ctx() {
  const c = new RequestContext();
  let tokenValue = "";
  const token = (v?: string) => {
    if (v !== undefined) tokenValue = v;
    return tokenValue;
  };
  c.session = { qg: { token } } as any;
  c.appURL = "/app/";
  c.sysURL = "/app/m/";
  c.lang = "de";
  return c;
}

Deno.test("HtmlBuilder: getHeader renders escaped metadata and assets", () => {
  const c = ctx();
  const html = new HtmlBuilder(c);
  html.titlePrefix = "Pre ";
  html.title = `<Title>`;
  html.titleSuffix = " & Suf";
  html.meta.description = `A "quote" & more`;
  html.meta.empty = "";
  html.link["/feed.xml?x=1&y=2"] = { rel: "alternate", title: `"Feed"` };
  html.styles.add("/style.css?x=1&y=2");
  html.legacyScripts.add("/main.js?x=1&y=2");
  html.scripts.add("/module.mjs?x=1&y=2");
  Object.assign(html.jsData, { hello: "<world>" });

  const out = html.getHeader();
  assertEquals(out.includes('<meta charset="utf-8">'), true);
  assertEquals(out.includes('<link href="/feed.xml?x=1&amp;y=2" rel="alternate" title="&quot;Feed&quot;" >'), true);
  assertEquals(out.includes('<link rel=stylesheet href="/style.css?x=1&amp;y=2">'), true);
  assertEquals(out.includes('<script type=json/c1>{"hello":"<world>"}</script>'), true);
  assertEquals(out.includes('<meta name=description content="A &quot;quote&quot; &amp; more">'), true);
  assertEquals(out.includes("name=empty"), false);
  assertEquals(out.includes('<title>Pre &lt;Title&gt; &amp; Suf</title>'), true);
  assertEquals(out.includes('<script defer src="/main.js?x=1&amp;y=2"></script>'), true);
  assertEquals(out.includes('<script type=module src="/module.mjs?x=1&amp;y=2"></script>'), true);
});

Deno.test("HtmlBuilder: render injects js_data defaults and content", () => {
  const c = ctx();
  const html = new HtmlBuilder(c);
  html.content = "<main>Hi</main>";

  const out = html.render();
  assertEquals(out.startsWith("<!DOCTYPE HTML>\n<html lang=de>"), true);
  assertEquals(out.includes("<main>Hi</main>"), true);
  assertEquals(html.jsData.appURL, "/app/");
  assertEquals(html.jsData.sysURL, "/app/m/");
  assertEquals(typeof html.jsData.qgToken, "string");
  assertEquals((html.jsData.qgToken as string).length, 11);
});
