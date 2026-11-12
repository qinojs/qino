import { test } from "node:test";
import { assertEquals } from "./deps.ts";
import { fill, tag } from "../pub/js/tag.js";

// A source that shows what it was asked, and a plain synchronous scope (as in the browser).
const source = (ns: string, original: string, values: unknown[], lang?: string) => `${ns}|${lang ?? ""}|${fill(original, values)}`;
const scope = () => {
  let current: Record<string, string> | undefined;
  return { get: () => current, run: (next: Record<string, string>, fn: () => unknown) => { const prev = current; current = next; try { return fn(); } finally { current = prev; } } };
};

test("tag: the original with placeholders, the global namespace by default", () => {
  const t = tag(source, scope());
  assertEquals(t`Hello ${"Qino"}, ${2}`, "||Hello Qino, 2");
});

test("tag: t.in binds a namespace, t.with sets the scope and restores it", () => {
  const t = tag(source, scope());
  assertEquals(t.in("cms")`A`, "cms||A");
  assertEquals(t.with("cms", () => t`A`), "cms||A");
  assertEquals(t.with({ ns: "fin", lang: "de" }, () => [t`A`, t.with({ lang: "fr" }, () => t`B`), t.in("cms")`C`]),
    ["fin|de|A", "fin|fr|B", "cms|de|C"]);
  assertEquals(t`A`, "||A");
});

test("fill: placeholders by position, null and undefined as empty", () => {
  assertEquals(fill("{1} {0} {2}", ["a", "b", null]), "b a ");
});
