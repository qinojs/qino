import { assert, assertEquals } from "./deps.ts";
import { Res } from "../lib/ctx/Res.ts";

Deno.test("Res: defaults are 200, empty headers, empty body", () => {
  const res = new Res();
  assertEquals(res.status, 200);
  assertEquals(res.body, "");
  assertEquals([...res.headers].length, 0);
});

Deno.test("Res: html stays lazy until first access", () => {
  const res = new Res();
  assertEquals(res.hasHtml, false);
  res.html.title = "t";
  assertEquals(res.hasHtml, true);
  assertEquals(res.html.title, "t"); // same instance on repeated access
});

Deno.test("Res: csp is instance-local", () => {
  const a = new Res();
  const b = new Res();
  assert(a.csp !== b.csp);
});
