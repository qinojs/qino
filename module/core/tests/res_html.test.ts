import { assertEquals } from "./deps.ts";
import { ResHtml } from "../lib/ctx/ResHtml.ts";

Deno.test("ResHtml: render renders escaped metadata and assets in head", () => {
  const html = new ResHtml();
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
  assertEquals(out.includes('<meta charset=utf-8>'), true);
  assertEquals(out.includes('<script type="importmap">{"imports":{"@qino/test":"/module.mjs","@qino/unsafe":"\\u003c/script>"}}</script>'), true);
  assertEquals(out.includes('<link href="/feed.xml?x=1&amp;y=2" rel="alternate" title="&quot;Feed&quot;">'), true);
  assertEquals(out.includes('<link rel=stylesheet href="/style.css?x=1&amp;y=2">'), true);
  assertEquals(out.includes('<script type=application/json id=qino-data>{"hello":"\\u003cworld>"}</script>'), true);
  assertEquals(out.includes('<meta name="description" content="A &quot;quote&quot; &amp; more">'), true);
  assertEquals(out.includes("name=empty"), false);
  assertEquals(out.includes('<title>Pre &lt;Title&gt; &amp; Suf</title>'), true);
  assertEquals(out.includes('<script src="/main.js?x=1&amp;y=2"></script>'), true);
  assertEquals(out.includes('<script type=module src="/module.mjs?x=1&amp;y=2"></script>'), true);
  assertEquals(out.indexOf(`<script type="importmap">`) < out.indexOf("<script type=module src"), true);
  // CSP hashes the map keys, so each must be byte-identical to what was rendered
  for (const js of html.inlineScripts.keys()) assertEquals(out.includes(`>${js}</script>`), true);
  html.render(); // an unchanged map re-uses its key instead of piling up
  assertEquals(html.inlineScripts.size, 1);
});

Deno.test("ResHtml: no import map, nothing to allow", () => {
  const html = new ResHtml();
  html.render();
  assertEquals(html.inlineScripts.size, 0);
});

Deno.test("ResHtml: a script-free page carries no import map and no data block", () => {
  const html = new ResHtml();
  html.importMap.set("@qino/pub/", "/m/core/pub/js/");
  Object.assign(html.jsData, { csrfToken: "secret" });
  assertEquals(html.render().includes("importmap"), false);
  assertEquals(html.render().includes("qino-data"), false);

  // any kind of script can resolve against it — a classic one via dynamic import()
  html.legacyScripts.add("/c1.js");
  assertEquals(html.render().includes('<script type="importmap">'), true);
});

Deno.test("ResHtml: inline scripts default to module and take attributes", () => {
  const html = new ResHtml();
  html.scripts.add("/m.mjs");
  html.inlineScripts.set(`alert("hi")`);
  html.inlineScripts.set("legacy()", { type: "text/javascript", id: `x"y` });

  const out = html.render();
  assertEquals(out.includes(`<script type="module">alert("hi")</script>`), true);
  assertEquals(out.includes(`<script type="text/javascript" id="x&quot;y">legacy()</script>`), true);
  assertEquals(out.indexOf("<script type=module src") < out.indexOf(`<script type="module">`), true);
});

Deno.test("ResHtml: an inline script cannot break out of its tag", () => {
  const html = new ResHtml();
  html.inlineScripts.set(`x = "</script><script>evil()"`);
  // escaped on the way in, so the key CSP hashes is already the body that gets rendered
  assertEquals([...html.inlineScripts.keys()], [`x = "<\\/script><script>evil()"`]);
  assertEquals(html.render().includes(`<script type="module">x = "<\\/script><script>evil()"</script>`), true);
});

Deno.test("ResHtml: inline styles come before the stylesheets and cannot break out of their tag", () => {
  const html = new ResHtml();
  html.styles.add("/site.css");
  html.inlineStyles.add("html{--color:red}");
  html.inlineStyles.add(`a::after{content:"</style><script>evil()"}`);

  const out = html.render();
  assertEquals(out.includes("<style>html{--color:red}</style>"), true);
  assertEquals(out.indexOf("<style>") < out.indexOf("<link rel=stylesheet"), true);
  // escaped on the way in, so the entry CSP hashes is already the body that gets rendered
  assertEquals(out.includes(`content:"<\\/style><script>evil()"`), true);
  for (const css of html.inlineStyles) assertEquals(out.includes(`<style>${css}</style>`), true);
});

Deno.test("ResHtml: render emits lang, classes and content", () => {
  const html = new ResHtml();
  html.lang = "de";
  html.class.add("theme");
  html.class.add(`unsafe"`);
  html.content = "<main>Hi</main>";

  const out = html.render();
  assertEquals(out.startsWith('<!DOCTYPE HTML>\n<html lang="de" class="theme unsafe&quot;">'), true);
  assertEquals(out.includes("<main>Hi</main>"), true);
  assertEquals(out.includes('<meta name="viewport" content="width=device-width">'), true);
});
