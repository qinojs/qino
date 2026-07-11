import { assert, assertEquals } from "./deps.ts";
import { ResponseBuilder } from "../lib/ctx/ResponseBuilder.ts";

Deno.test("ResponseBuilder: defaults are 200, empty headers, empty body", () => {
  const res = new ResponseBuilder();
  assertEquals(res.status, 200);
  assertEquals(res.body, "");
  assertEquals([...res.headers].length, 0);
});

Deno.test("ResponseBuilder: html stays lazy until first access", () => {
  const res = new ResponseBuilder();
  assertEquals(res.hasHtml, false);
  res.html.title = "t";
  assertEquals(res.hasHtml, true);
  assertEquals(res.html.title, "t"); // same instance on repeated access
});

Deno.test("ResponseBuilder: csp is instance-local", () => {
  const a = new ResponseBuilder();
  const b = new ResponseBuilder();
  assert(a.csp !== b.csp);
});
