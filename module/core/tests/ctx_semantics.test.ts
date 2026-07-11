// Characterization tests: pin today's RequestContext semantics before the
// ctx.req/ctx.res split (CONTEXT-REQUEST-PLAN.md Phase 1). Body and deadline
// behavior live in body.test.ts / request_context_timeout.test.ts.
import { assert, assertEquals, assertRejects, testContext } from "./deps.ts";
import { Output } from "../lib/util.ts";
import { parseCookies } from "../lib/ctx/ContextRequest.ts";

Deno.test("ctx paths: appURL gets a trailing slash, sysURL derives from it", async () => {
  const ctx = await testContext({ url: "http://qino.test/cms1/de/page", basePath: "/cms1" });
  assertEquals(ctx.appURL, "/cms1/");
  assertEquals(ctx.sysURL, "/cms1/m/");
});

Deno.test("ctx paths: appRequestPath is decoded, without base prefix and query", async () => {
  const ctx = await testContext({ url: "http://qino.test/cms1/a%2Fb/c?q=1", basePath: "/cms1/" });
  assertEquals(ctx.appRequestPath, "a/b/c");

  const root = await testContext({ url: "http://qino.test/" });
  assertEquals(root.appRequestPath, "");
});

Deno.test("ctx paths: malformed percent-encoding rejects with a 400 Output", async () => {
  const err = await assertRejects(() => testContext({ url: "http://qino.test/%zz" }), Output);
  assertEquals((err as Output).status, 400);
});

Deno.test("ctx query: first value wins, frozen, prototype-safe", async () => {
  const ctx = await testContext({ url: "http://qino.test/?a=1&a=2&__proto__=x" });
  assertEquals(ctx.get.a, "1");
  assertEquals(ctx.get.__proto__, "x"); // plain data key, not the prototype
  assertEquals(Object.getPrototypeOf(ctx.get), null);
  assert(Object.isFrozen(ctx.get));
});

Deno.test("ctx query: queryAll keeps every repeated value in order, frozen", async () => {
  const ctx = await testContext({ url: "http://qino.test/?a=1&b=x&a=2" });
  assertEquals(ctx.req.queryAll, { a: ["1", "2"], b: ["x"] });
  assert(Object.isFrozen(ctx.req.queryAll));
  assert(Object.isFrozen(ctx.req.queryAll.a));
});

Deno.test("ctx cookies: request cookies land on ctx.cookie", async () => {
  const ctx = await testContext({ headers: { cookie: "a=1; b=hello%20world" } });
  assertEquals(ctx.cookie.a, "1");
  assertEquals(ctx.cookie.b, "hello world");
});

Deno.test("cookies: broken percent-encoding stays raw", () => {
  assertEquals(parseCookies("bad=%zz; ok=1"), { bad: "%zz", ok: "1" });
});

Deno.test("ctx url: fresh copy per access, host keeps the port, hostname does not", async () => {
  const ctx = await testContext({ url: "http://qino.test:8080/a%2Fb?q=1" });
  assertEquals(ctx.url.host, "qino.test:8080");
  assertEquals(ctx.url.hostname, "qino.test");
  assertEquals(ctx.url.port, "8080");
  assertEquals(ctx.url.pathname, "/a%2Fb"); // URL path stays encoded (vs. decoded appRequestPath)
  assertEquals(ctx.url.search, "?q=1");
  assert(ctx.url !== ctx.url); // mutation-safe: every access is an independent copy
});

Deno.test("ctx response defaults: 200, empty body, empty headers", async () => {
  const ctx = await testContext();
  assertEquals(ctx.responseStatus, 200);
  assertEquals(ctx.responseBody, "");
  assertEquals([...ctx.responseHeaders].length, 0);
});

Deno.test("ctx html: lazy — hasHtml stays false until first access", async () => {
  const ctx = await testContext();
  assertEquals(ctx.hasHtml, false);
  ctx.html.title = "t";
  assertEquals(ctx.hasHtml, true);
});

Deno.test("ctx csp: request-local, not shared between contexts", async () => {
  const a = await testContext();
  const b = await testContext();
  assert(a.csp !== b.csp);
});

Deno.test("Output: toResponse carries status, body and built headers", () => {
  const out = new Output("nope", { status: 403, headers: { "X-Test": "1" } });
  const res = out.toResponse();
  assertEquals(res.status, 403);
  assertEquals(res.headers.get("X-Test"), "1");
});
