import { createHash } from "node:crypto";
import { NotFoundError, requestStorage } from "@qino/qino";
import { apiRequest, assertEquals, assertRejects, assertStringIncludes, testContext } from "@qino/qino/tests";

import { cms } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

Deno.test("API key backend: creation stays local, stores a hash and shows the token only once", async () => {
  let stored: Record<string, unknown> | undefined;
  const db = {
    one: (_sql: unknown, id: number) => id === 8 ? 8 : null,
    query: () => [],
    table: () => ({ insert: (data: Record<string, unknown>) => { stored = data; return 42; } }),
  };
  const sess = { data: { core: { userId: () => 7, via: () => ({}) } } };
  const ctx = await testContext({ method: "POST", userId: 7, sess, app: { db }, set: { csrfToken: "test" } });
  const node = { app: ctx.app } as Node;
  const vars = { create: { usr_id: "8", name: "Integration" } };
  const result = await requestStorage.run(ctx, () => cms.node.api(node, vars));
  const token = result!.token;
  const out = String(await cms.node.render(node, { ctx, vars }));
  assertEquals(stored?.usr_id, 8);
  assertEquals(stored?.name, "Integration");
  assertEquals(stored?.hash, createHash("sha256").update(token).digest("hex"));
  assertEquals(Object.values(stored!).includes(token), false);
  assertStringIncludes(out, "API-Keys");
  assertEquals(String(await cms.node.render(node, { ctx })).includes(token), false);

  stored = undefined;
  await requestStorage.run(ctx, () => assertRejects(() => cms.node.api(node, { create: { usr_id: "99" } }), NotFoundError));
  assertEquals(stored, undefined);

  const bearer = await testContext({ method: "POST", userId: 7, sess, app: { db }, set: { statelessAuth: true } });
  const error = await requestStorage.run(bearer, () => assertRejects(() => cms.node.api(node, vars))) as { code?: string };
  assertEquals(error.code, "step_up_required");
  assertEquals(stored, undefined);

  const get = await testContext({ userId: 7, sess, app: { db }, set: { csrfToken: "test" } });
  await cms.node.render(node, { ctx: get, vars });
  assertEquals(stored, undefined);
});

Deno.test("API key backend: an expired proof reaches the client as step_up_required, then creation can be retried", async () => {
  let created = 0;
  let password = 1;
  const db = { one: () => 8, table: () => ({ insert: () => ++created }) };
  const modules = { linked: () => [{ name: "auth.password", plugin: { authFactors: [{ name: "password", label: "Password", stepUp: true }] } }] };
  const sess = { data: { core: { userId: () => 7, via: () => ({ password }) } } };
  const ctx = await testContext({ userId: 7, sess, app: { db, modules }, set: { csrfToken: "test" } });
  const node = { app: ctx.app } as Node;
  const tree = { post: { access: () => true, execute: () => cms.node.api(node, { create: { usr_id: "8" } }) } };
  const call = () => requestStorage.run(ctx, () => apiRequest(tree, "/", { method: "POST", headers: { origin: "http://qino.test", "X-CSRF-Token": "test" } }));

  const challenge = await call();
  assertEquals(challenge.status, 403);
  const error = await challenge.json();
  assertEquals(error.code, "step_up_required");
  assertEquals(error.data.factors, [{ name: "password", label: "Password", module: "auth.password" }]);
  assertEquals(created, 0);

  password = Math.floor(Date.now() / 1000);
  const response = await call();
  assertEquals(response.status, 200);
  assertEquals(typeof (await response.json()).token, "string");
  assertEquals(created, 1);
});
