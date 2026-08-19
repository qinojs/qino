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

Deno.test("Res: answered tells an untouched response from a deliberate one", () => {
  assertEquals(new Res().answered, false);

  const html = new Res();
  html.html.title = "t";
  assertEquals(html.answered, true);

  const body = new Res();
  body.body = "x";
  assertEquals(body.answered, true);

  const redirect = new Res();
  redirect.headers.set("Location", "/");
  assertEquals(redirect.answered, true);

  const empty200 = new Res(); // meaning it, rather than never having been touched
  empty200.status = 200;
  assertEquals(empty200.answered, true);
});
