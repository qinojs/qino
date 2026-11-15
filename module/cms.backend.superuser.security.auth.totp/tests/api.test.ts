import { test } from "node:test";
import { requestStorage } from "@qino/qino";
import { assertEquals, assertRejects, fakeRender, testContext } from "@qino/qino/tests";

import { cms } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

test("Authenticator backend: removing someone's app needs a fresh proof", async () => {
  const removed: unknown[][] = [];
  // deno-lint-ignore no-explicit-any
  const db = { exec: (...a: any[]) => { removed.push(fakeRender(a[0], a.slice(1))[1]); return { affectedRows: 1 }; } };
  const sess = { data: { core: { userId: () => 7, via: () => ({}) } } };

  // a token proves no person is present
  const bearer = await testContext({ method: "POST", userId: 7, sess, app: { db }, set: { statelessAuth: true } });
  const error = await requestStorage.run(bearer, () => assertRejects(() => cms.node.api({ app: bearer.app } as Node, { forget: "5", usr_id: "8" }))) as { code?: string };
  assertEquals(error.code, "step_up_required");
  assertEquals(removed, []);

  // nothing to prove with set up: the app of user 8 goes
  const ctx = await testContext({ method: "POST", userId: 7, sess, app: { db } });
  assertEquals(await requestStorage.run(ctx, () => cms.node.api({ app: ctx.app } as Node, { forget: "5", usr_id: "8" })), { ok: true });
  assertEquals(removed, [[8, "totp", 5]]);
});
