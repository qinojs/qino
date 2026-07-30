import { assertEquals, assert } from "./deps.ts";
import { parseCookies, Req } from "../lib/ctx/Req.ts";

const reqUrl = (headers: HeadersInit, trustedProxyHops: number) =>
  Req.create(new Request("http://qino.test/x", { headers }), { trustedProxyHops }).then((r) => r.url.href);

Deno.test("Req: a trusted proxy's x-forwarded-proto decides the public scheme", async () => {
  assertEquals(await reqUrl({ "x-forwarded-proto": "https" }, 1), "https://qino.test/x");
  assertEquals(await reqUrl({ "x-forwarded-proto": "https, http" }, 1), "https://qino.test/x");
  assertEquals(await reqUrl({}, 1), "http://qino.test/x");
});

Deno.test("Req: without a trusted proxy the header is ignored (unspoofable)", async () => {
  assertEquals(await reqUrl({ "x-forwarded-proto": "https" }, 0), "http://qino.test/x");
  assertEquals(await reqUrl({ "x-forwarded-proto": "gopher" }, 1), "http://qino.test/x");
});

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
  assert(Object.getPrototypeOf(cookies) === null);
});
