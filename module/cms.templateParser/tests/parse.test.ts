import { assertEquals } from "@qino/qino/tests";

import { parseTemplate } from "../parse.ts";

import type { TNode } from "../parse.ts";

type El = Extract<TNode, { type: "element" }>;
const el = (n: TNode): El => n as El;

Deno.test("parseTemplate: text and nested elements", () => {
  const ast = parseTemplate("Hello <div><b>world</b></div>!");
  assertEquals(ast.length, 3);
  assertEquals(ast[0], { type: "text", value: "Hello " });
  assertEquals(el(ast[1]).tag, "div");
  assertEquals(el(el(ast[1]).children[0]).tag, "b");
  assertEquals(el(ast[1]).children.length, 1);
  assertEquals(ast[2], { type: "text", value: "!" });
});

Deno.test("parseTemplate: attribute forms — quoted, single, unquoted, bare, empty", () => {
  const ast = parseTemplate(`<div a="1" b='2' c=3 d e="">x</div>`);
  assertEquals(el(ast[0]).attrs, [
    { name: "a", value: "1" },
    { name: "b", value: "2" },
    { name: "c", value: "3" },
    { name: "d", value: null },
    { name: "e", value: "" },
  ]);
});

Deno.test("parseTemplate: '>' inside quoted attribute value", () => {
  const ast = parseTemplate(`<a title="a > b">x</a>`);
  assertEquals(el(ast[0]).attrs, [{ name: "title", value: "a > b" }]);
  assertEquals(el(ast[0]).children, [{ type: "text", value: "x" }]);
});

Deno.test("parseTemplate: comments and doctype are stripped", () => {
  const ast = parseTemplate("<!doctype html><!-- note <b>bold</b> -->a<!-- x -->b");
  assertEquals(ast, [
    { type: "text", value: "a" },
    { type: "text", value: "b" },
  ]);
});

Deno.test("parseTemplate: void elements need no closing tag", () => {
  const ast = parseTemplate("<img src=x><br>text");
  assertEquals(el(ast[0]).tag, "img");
  assertEquals(el(ast[0]).self, true);
  assertEquals(el(ast[1]).tag, "br");
  assertEquals(ast[2], { type: "text", value: "text" });
});

Deno.test("parseTemplate: self-closing non-void element", () => {
  const ast = parseTemplate("<cms-cont name=body />after");
  assertEquals(el(ast[0]).tag, "cms-cont");
  assertEquals(el(ast[0]).self, true);
  assertEquals(el(ast[0]).attrs, [{ name: "name", value: "body" }]);
  assertEquals(el(ast[0]).children, []);
  assertEquals(ast[1], { type: "text", value: "after" });
});

Deno.test("parseTemplate: unbalanced close tag pops open elements", () => {
  const ast = parseTemplate("<div><span>x</div>after");
  const div = el(ast[0]);
  assertEquals(div.tag, "div");
  assertEquals(el(div.children[0]).tag, "span");
  assertEquals(ast[1], { type: "text", value: "after" });
});

Deno.test("parseTemplate: tag names are lowercased", () => {
  const ast = parseTemplate("<DIV>x</DIV>");
  assertEquals(el(ast[0]).tag, "div");
  assertEquals(el(ast[0]).children, [{ type: "text", value: "x" }]);
});

Deno.test("parseTemplate: script/style/textarea content stays raw text", () => {
  const ast = parseTemplate("<div><script>if (a < b) x('</b>');</script></div>");
  const script = el(el(ast[0]).children[0]);
  assertEquals(script.tag, "script");
  assertEquals(script.children, [{ type: "text", value: "if (a < b) x('</b>');" }]);
  assertEquals(el(ast[0]).children.length, 1);
});

Deno.test("parseTemplate: unclosed raw text element takes the rest", () => {
  const ast = parseTemplate("<style>a { color: red }");
  assertEquals(el(ast[0]).children, [{ type: "text", value: "a { color: red }" }]);
});

Deno.test("parseTemplate: braces are plain text (no expressions)", () => {
  const ast = parseTemplate(`<span class="lang-{lang}">a {x} b</span>`);
  assertEquals(el(ast[0]).attrs, [{ name: "class", value: "lang-{lang}" }]);
  assertEquals(el(ast[0]).children, [{ type: "text", value: "a {x} b" }]);
});
