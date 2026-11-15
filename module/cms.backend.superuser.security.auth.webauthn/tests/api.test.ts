import { test } from "node:test";
import { requestStorage } from "@qino/qino";
import { assertEquals, assertRejects, testContext } from "@qino/qino/tests";

import { cms } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

test("WebAuthn backend: deleting someone's passkey needs a fresh proof", async () => {
  const deleted: unknown[] = [];
  const db = { table: () => ({ delete: (id: unknown) => { deleted.push(id); return true; } }) };
  const sess = { data: { core: { userId: () => 7, via: () => ({}) } } };

  // a token proves no person is present
  const bearer = await testContext({ method: "POST", userId: 7, sess, app: { db }, set: { statelessAuth: true } });
  const node = { app: bearer.app } as Node;
  const error = await requestStorage.run(bearer, () => assertRejects(() => cms.node.api(node, { delete: "5" }))) as { code?: string };
  assertEquals(error.code, "step_up_required");
  assertEquals(deleted, []);

  // nothing to prove with set up: the delete goes through
  const ctx = await testContext({ method: "POST", userId: 7, sess, app: { db } });
  assertEquals(await requestStorage.run(ctx, () => cms.node.api({ app: ctx.app } as Node, { delete: "5" })), { ok: true });
  assertEquals(deleted, [5]);
  assertEquals(await requestStorage.run(ctx, () => cms.node.api({ app: ctx.app } as Node, {})), null);
});
