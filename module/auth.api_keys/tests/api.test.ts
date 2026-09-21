import { invoke, requestStorage } from "@qino/qino";
import { assertEquals, assertRejects, testContext } from "@qino/qino/tests";

import { api } from "../api.ts";

Deno.test("auth.api_keys: a key creates another key only after a fresh step-up, like any session", async () => {
  const sess = { data: { core: { userId: () => 7, via: () => ({}) } } };
  const db = { one: () => null, table: () => ({ row: () => ({ id: 7 }) }) };
  const password = { name: "password", label: "Password", stepUp: true };
  const modules = { linked: () => [{ name: "core", plugin: { authFactors: [password] } }] };
  const ctx = await testContext({ userId: 7, sess, app: { db, modules }, set: { statelessAuth: true } });
  const e = await requestStorage.run(ctx, () => assertRejects(() => invoke(api, "POST", "/", {}))) as { code?: string };
  assertEquals(e.code, "step_up_required");
});
