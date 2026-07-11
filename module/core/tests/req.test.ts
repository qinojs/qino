import { assertEquals, assert } from "./deps.ts";
import { parseCookies } from "../lib/ctx/ContextRequest.ts";

Deno.test("parseCookies keeps the first cookie when paths provide duplicate names", () => {
  assertEquals(parseCookies("qinoSess=cms1; qinoSess=root; cid=client"), {
    qinoSess: "cms1",
    cid: "client",
  });
});

Deno.test("parseCookies keeps prototype-looking names inert", () => {
  const cookies = parseCookies("__proto__=x; constructor=y; toString=z");
  assertEquals(cookies.__proto__, "x");
  assertEquals(cookies["constructor"], "y");
  assertEquals(cookies["toString"], "z");
  assert(!Object.prototype.isPrototypeOf(cookies));
});
