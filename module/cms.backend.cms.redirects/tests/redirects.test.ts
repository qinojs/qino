import { assertEquals } from "@qino/qino/tests";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };
import { cleanRequest, renderRows, unsafe } from "../render.ts";

import type { Row } from "../render.ts";

const { name, dependencies } = manifest;

const labels = {
  root: "Start",
  orphan: "orphaned",
  shadowed: "shadowed",
  external: "external",
  confirm: "Really delete this direct link?",
  empty: "No direct links",
};

const row = (o: Partial<Row>): Row => ({
  request: "menu", redirect: "146", kind: "page", title: "Speisekarte",
  href: "/de/speisekarte", shadowed: false, root: false, ...o,
});

Deno.test("cms.backend.cms.redirects: metadata is wired", () => {
  assertEquals(name, "cms.backend.cms.redirects");
  assertEquals(dependencies, ["cms.backend"]);
  assertEquals(typeof cms.node.render, "function");
  assertEquals(typeof cms.node.parts.list, "function");
});

Deno.test("cms.backend.cms.redirects: a live link shows its target, editable in place", () => {
  const out = String(renderRows([row({})], labels));
  assertEquals(out.includes('<tr data-from="menu">'), true); // one data-from per row, both cells save it
  assertEquals(out.includes('<input data-request value="menu" size=16>'), true);
  assertEquals(out.includes('type=qgcms-page data-target value="146"'), true);
  assertEquals(out.includes('<a href="/de/speisekarte" target=_blank>Speisekarte</a>'), true);
  assertEquals(out.includes('data-delete="menu"'), true);
  assertEquals(out.includes("orphaned"), false);
});

Deno.test("cms.backend.cms.redirects: a target that is gone is marked, not hidden", () => {
  const out = String(renderRows([row({ request: "asdfads", redirect: "999", kind: "orphan", title: "", href: "" })], labels));
  assertEquals(out.includes("orphaned"), true);
  assertEquals(out.includes('data-delete="asdfads"'), true); // findable and removable, which is the point
});

Deno.test("cms.backend.cms.redirects: a request a page url already answers is marked shadowed", () => {
  const out = String(renderRows([row({ request: "de/home", shadowed: true })], labels));
  assertEquals(out.includes("shadowed"), true);
  assertEquals(out.includes('style="background:var(--red)"'), true); // the only styling: the house badge
});

Deno.test("cms.backend.cms.redirects: the entry link is retargetable but not renamable or deletable", () => {
  const out = String(renderRows([row({ request: "", redirect: "2", title: "Home", href: "/de/home", root: true })], labels));
  assertEquals(out.includes("Start"), true);
  assertEquals(out.includes('<input data-request value="/" size=16 readonly>'), true); // an empty box would read as a bug
  assertEquals(out.includes("data-delete"), false); // deleting it would 404 the domain root
  assertEquals(out.includes('data-target value="2"'), true); // where "/" goes is a normal edit
});

Deno.test("cms.backend.cms.redirects: an external target is linked as it stands", () => {
  const out = String(renderRows([
    row({ request: "shop", redirect: "https://shop.example/x", kind: "external", title: "", href: "https://shop.example/x" }),
  ], labels));
  assertEquals(out.includes("external"), true);
  assertEquals(out.includes('<a href="https://shop.example/x" target=_blank>https://shop.example/x</a>'), true);
});

Deno.test("cms.backend.cms.redirects: titles and targets from the database are escaped", () => {
  const out = String(renderRows([
    row({ request: '"><script>alert(1)</script>', title: '<img src=x onerror="alert(1)">', href: "/de/x" }),
  ], labels));
  assertEquals(out.includes("<script>alert"), false);
  assertEquals(out.includes("<img src=x"), false);
  assertEquals(out.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"), true);
});

Deno.test("cms.backend.cms.redirects: an empty list says so instead of rendering nothing", () => {
  assertEquals(String(renderRows([], labels)).includes("No direct links"), true);
});

Deno.test("cms.backend.cms.redirects: a request is stored the way render.ts matches it", () => {
  assertEquals(cleanRequest(" /menu/ "), "menu");
  assertEquals(cleanRequest("//a//b//"), "a//b");
  assertEquals(cleanRequest("/"), ""); // "/" is the entry link, and that is the empty request
});

Deno.test("cms.backend.cms.redirects: script schemes are refused as targets", () => {
  assertEquals(unsafe("javascript:alert(1)"), true);
  assertEquals(unsafe("JavaScript:alert(1)"), true);
  assertEquals(unsafe("data:text/html,x"), true);
  assertEquals(unsafe("https://example.com"), false);
  assertEquals(unsafe("146"), false);
});
