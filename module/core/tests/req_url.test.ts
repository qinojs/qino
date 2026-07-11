import { assert, assertEquals } from "./deps.ts";
import { RequestUrl } from "../lib/ctx/RequestUrl.ts";

const url = new RequestUrl("http://user@qino.test:8080/a%2Fb/c?x=1&x=2#frag");

Deno.test("RequestUrl: exposes the read-only URL parts", () => {
  assertEquals(url.href, "http://user@qino.test:8080/a%2Fb/c?x=1&x=2#frag");
  assertEquals(url.origin, "http://qino.test:8080");
  assertEquals(url.protocol, "http:");
  assertEquals(url.host, "qino.test:8080");
  assertEquals(url.hostname, "qino.test");
  assertEquals(url.port, "8080");
  assertEquals(url.pathname, "/a%2Fb/c");
  assertEquals(url.search, "?x=1&x=2");
  assertEquals(url.hash, "#frag");
});

Deno.test("RequestUrl: instance is frozen and has no searchParams backdoor", () => {
  assert(Object.isFrozen(url));
  assertEquals("searchParams" in url, false);
  assert(!(url instanceof URL));
});

Deno.test("RequestUrl: toURL() returns an independent mutable native URL", () => {
  const copy = url.toURL();
  assert(copy instanceof URL);
  copy.protocol = "https:";
  copy.searchParams.set("x", "changed");
  assertEquals(url.protocol, "http:"); // original untouched
  assertEquals(url.search, "?x=1&x=2");
  assert(copy !== url.toURL()); // every call is a fresh copy
});

Deno.test("RequestUrl: stringifies to href", () => {
  assertEquals(`${url}`, url.href);
  assertEquals(url.toString(), url.href);
  assertEquals(JSON.stringify(url), JSON.stringify(url.href));
  // deno-lint-ignore no-explicit-any
  assertEquals((url as any) + "", url.href);
});
