import { assertEquals } from "./deps.ts";
import { ResCsp } from "../mod.ts";

const directive = (csp: ResCsp, name: string) =>
  csp.toHeader().split("; ").find((part) => part.startsWith(name + " "))!.slice(name.length + 1).split(" ");

Deno.test("csp: sources below a declared directory collapse into it", () => {
  const csp = new ResCsp();
  const store = "https://cdn.example/store@1/";
  csp["script-src"][store] = true;
  csp["script-src"][store + "mod.a/"] = true;      // covered by the store
  csp["script-src"][store + "mod.a/pub/x.js"] = true;
  csp["script-src"]["https://other.example/lib/"] = true; // elsewhere, stays

  assertEquals(directive(csp, "script-src"), ["'self'", store, "https://other.example/lib/", "'report-sample'"]);
});

Deno.test("csp: a source without a trailing slash covers nothing but itself", () => {
  const csp = new ResCsp();
  csp["script-src"]["https://cdn.example/dump"] = true;
  csp["script-src"]["https://cdn.example/dump.js"] = true; // sibling, not below it

  assertEquals(directive(csp, "script-src"), ["'self'", "https://cdn.example/dump", "https://cdn.example/dump.js", "'report-sample'"]);
});
