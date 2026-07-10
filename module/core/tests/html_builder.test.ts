import { assertEquals } from "./deps.ts";
import { HtmlBuilder } from "../lib/ctx/HtmlBuilder.ts";

Deno.test("HtmlBuilder: render renders escaped metadata and assets in head", () => {
  const html = new HtmlBuilder();
  html.titlePrefix = "Pre ";
  html.title = `<Title>`;
  html.titleSuffix = " & Suf";
  html.meta.description = `A "quote" & more`;
  html.meta.empty = "";
  html.link["/feed.xml?x=1&y=2"] = { rel: "alternate", title: `"Feed"` };
  html.styles.add("/style.css?x=1&y=2");
  html.legacyScripts.add("/main.js?x=1&y=2");
  html.scripts.add("/module.mjs?x=1&y=2");
  html.importMap.set("@qino/test", "/module.mjs");
  html.importMap.set("@qino/unsafe", "</script>");
  Object.assign(html.jsData, { hello: "<world>" });

  const out = html.render();
  assertEquals(out.startsWith('<!DOCTYPE HTML>\n<html lang="en">'), true);
  assertEquals(out.includes('<meta charset="utf-8">'), true);
  assertEquals(out.includes('<script type=importmap>{"imports":{"@qino/test":"/module.mjs","@qino/unsafe":"\\u003c/script>"}}</script>'), true);
  assertEquals(out.includes('<link href="/feed.xml?x=1&amp;y=2" rel="alternate" title="&quot;Feed&quot;">'), true);
  assertEquals(out.includes('<link rel=stylesheet href="/style.css?x=1&amp;y=2">'), true);
  assertEquals(out.includes('<script type=json/c1>{"hello":"\\u003cworld>"}</script>'), true);
  assertEquals(out.includes('<meta name="description" content="A &quot;quote&quot; &amp; more">'), true);
  assertEquals(out.includes("name=empty"), false);
  assertEquals(out.includes('<title>Pre &lt;Title&gt; &amp; Suf</title>'), true);
  assertEquals(out.includes('<script src="/main.js?x=1&amp;y=2"></script>'), true);
  assertEquals(out.includes('<script type=module src="/module.mjs?x=1&amp;y=2"></script>'), true);
  assertEquals(out.indexOf("<script type=importmap>") < out.indexOf("<script type=module"), true);
});

Deno.test("HtmlBuilder: render emits lang, classes and content", () => {
  const html = new HtmlBuilder();
  html.lang = "de";
  html.class.add("theme");
  html.class.add(`unsafe"`);
  html.content = "<main>Hi</main>";

  const out = html.render();
  assertEquals(out.startsWith('<!DOCTYPE HTML>\n<html lang="de" class="theme unsafe&quot;">'), true);
  assertEquals(out.includes("<main>Hi</main>"), true);
  assertEquals(out.includes('<meta name="viewport" content="width=device-width">'), true);
});
