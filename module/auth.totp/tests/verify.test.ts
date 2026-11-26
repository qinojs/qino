import { test } from "node:test";
import { assertEquals, assertRejects } from "@std/assert";
import { ApiError, Db } from "@qino/qino";
import { store } from "@qino/qino/auth";
import { authAttemptDbSchema } from "@qino/qino/tests";

import authSchema from "../../auth/dbschema.json" with { type: "json" };
import { at, secret } from "../lib/totp.ts";
import { verify } from "../mod.ts";
import { authFactors } from "../plugin.ts";

import type { Ctx } from "@qino/qino";

/** A signed-in user 7 with one authenticator app, on a real database. */
async function setup() {
  const db = new Db("sqlite::memory:");
  await db.migrate({ properties: { ...authSchema.properties, ...authAttemptDbSchema.properties } });
  await db.loadTables();
  const app = {
    db,
    modules: { linked: () => [{ name: "auth.totp", plugin: { authFactors } }] },
    fire: (_name: string, e: unknown) => Promise.resolve(e),
    [Symbol.asyncDispose]: () => db.close(),
  };
  const s = secret();
  await store(app as never, 7, "totp", { secret: s });
  const sess = { data: { core: { via: new Proxy({}, { get: () => () => {} }) } } };
  const ctx = { app, userId: 7, sess } as unknown as Ctx;
  return { app, ctx, code: () => at(s, Math.floor(Date.now() / 1000 / 30)) };
}

test("totp: a code counts once", async () => {
  const { app, ctx, code } = await setup();
  await using _ = app;
  const c = await code();
  assertEquals(await verify(ctx, c), true);
  await assertRejects(() => verify(ctx, c), ApiError, "does not match");
});

// SQLite serializes the statements anyway; the guard in SQL is what holds on pooled drivers
test("totp: a code sent twice at once counts once", async () => {
  const { app, ctx, code } = await setup();
  await using _ = app;
  const c = await code();
  const both = await Promise.allSettled([verify(ctx, c), verify(ctx, c)]);
  assertEquals(both.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
});
