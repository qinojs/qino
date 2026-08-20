import { checkSessionGrant, createSessionGrant } from "../mod.ts";
import { assertEquals, testContext } from "./deps.ts";

function session() {
  let key = "";
  return { data: { core: {
    userId: () => 0,
    grantKey: (value?: string) => value === undefined ? key : (key = value),
  } } };
}

Deno.test("session grants are scoped to one session and resource", async () => {
  const ctx = await testContext({ sess: session() });
  const grant = createSessionGrant(ctx, "example", "one");
  assertEquals(grant.sig.length, 22);
  assertEquals(checkSessionGrant(ctx, "example", "one", grant.exp, grant.sig), "ok");
  assertEquals(checkSessionGrant(ctx, "example", "two", grant.exp, grant.sig), "forged");
  assertEquals(checkSessionGrant(ctx, "other", "one", grant.exp, grant.sig), "forged");
  assertEquals(checkSessionGrant(await testContext({ sess: session() }), "example", "one", grant.exp, grant.sig), "forged");
});

Deno.test("session grants distinguish unsigned, forged and expired values", async () => {
  const ctx = await testContext({ sess: session() });
  assertEquals(checkSessionGrant(ctx, "example", "one", undefined, undefined), "unsigned");
  assertEquals(checkSessionGrant(ctx, "example", "one", "1e12", "x"), "forged");
  const grant = createSessionGrant(ctx, "example", "one", -1);
  assertEquals(checkSessionGrant(ctx, "example", "one", grant.exp, grant.sig), "expired");
});
