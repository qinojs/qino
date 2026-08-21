import { grant } from "../mod.ts";
import { assertEquals, testContext } from "./deps.ts";

import type { App } from "../mod.ts";

function session() {
  let key = "";
  return { data: { core: {
    userId: () => 0,
    grantKey: (value?: string) => value === undefined ? key : (key = value),
  } } };
}

function app() {
  let value = "";
  const setting = Object.assign((next: string) => void (value = next), {
    then: (resolve: (value: string) => void) => resolve(value),
  });
  return { settings: { core: { _secret: setting } } } as unknown as App;
}

Deno.test("session grants belong to one session and resource", async () => {
  const own = (await testContext({ sess: session() })).sess;
  const proof = grant.sign(own, "example\0one");
  assertEquals(proof.sig.length, 22);
  assertEquals(grant.verify(own, "example\0one", proof), "ok");
  assertEquals(grant.verify(own, "example\0two", proof), "forged");
  assertEquals(grant.verify((await testContext({ sess: session() })).sess, "example\0one", proof), "forged");
});

Deno.test("session grants distinguish unsigned, forged and expired values", async () => {
  const sess = (await testContext({ sess: session() })).sess;
  assertEquals(grant.verify(sess, "example\0one", {}), "unsigned");
  assertEquals(grant.verify(sess, "example\0one", { exp: "1e12", sig: "x" }), "forged");
  const proof = grant.sign(sess, "example\0one", { ttl: -1 });
  assertEquals(grant.verify(sess, "example\0one", proof), "expired");
});

Deno.test("permanent grants belong to one app and resource", async () => {
  const own = app();
  const proof = await grant.sign(own, "example\0one");
  assertEquals(proof.sig.length, 22);
  assertEquals(await grant.verify(own, "example\0one", proof), "ok");
  assertEquals(await grant.verify(own, "example\0two", proof), "forged");
  assertEquals(await grant.verify(app(), "example\0one", proof), "forged");
  assertEquals(await grant.verify(own, "example\0one", {}), "unsigned");
});
