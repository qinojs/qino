import coreSchema from "../dbschema.json" with { type: "json" };
import { fakeSettings } from "./appFake.ts";
import { apiFetch } from "../lib/api/mod.ts";
import { Req } from "../lib/ctx/Req.ts";
import { Ctx } from "../lib/ctx/Ctx.ts";
import { Output } from "../lib/util.ts";

import type { ApiTree } from "../lib/api/mod.ts";

export { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";

/** The core table that holds what a wrong proof costs the next one — a factor's tests migrate it
 *  next to their own schema, because the count belongs to the account and not to the method. */
export const authAttemptDbSchema = { properties: { usr_auth_attempt: coreSchema.properties.usr_auth_attempt } };
export const contactDbSchema = { properties: { usr_contact: coreSchema.properties.usr_contact } };
export const fileDbSchema = { properties: { file: coreSchema.properties.file } };
// Not in mod.ts on purpose — App and Db extend it, nobody else needs to construct one.
export { Emitter } from "../lib/Emitter.ts";
export { DbFileManager } from "../lib/DbFileManager.ts";
export { fakeRender } from "./sqlFake.ts";
// settings plumbing: tests that need a real (not faked) settings tree
export { createSettingItem } from "../lib/SettingItem.ts";
export { enableItemSchemaDefaults } from "../lib/util.ts";
export { fakeSettings, fakeT } from "./appFake.ts";


// deno-lint-ignore no-explicit-any
type Fake = Record<string, any>;

export type TestContextInit = RequestInit & {
  url?: string;
  /** Mount prefix, default "/". */
  appUrl?: string;
  /** Partial `App` fake, merged over the built-in minimal one. */
  app?: Fake;
  /** Partial `Session` fake; default is a guest session driven by `userId`. */
  sess?: Fake;
  userId?: number;
  /** Force-assigned ctx fields, shadowing prototype getters (e.g. `post`). */
  set?: Fake;
};

/** Build a Ctx through the production `Ctx.create()` path. */
export async function testContext(init: TestContextInit = {}): Promise<Ctx> {
  const { url = "http://qino.test/", appUrl = "/", app = {}, sess, userId = 0, set, ...reqInit } = init;
  const session = sess ?? { data: { core: { userId: () => userId, pending: () => undefined } } };
  const appFake = {
    sessions: { loadFromRequest: () => session },
    trustedProxyHops: 0,
    db: { one: () => null, table: () => ({ get: () => undefined }) }, // an app with an empty database
    dbFiles: { file: () => undefined },
    ...app,
    settings: fakeSettings({ core: {}, ...app.settings }),
  };
  const ctx = await Ctx.create(appFake as never, new Request(url, reqInit), { appUrl });
  // initRequest loads the user row, which is what makes ctx.user read synchronously — a fake app
  // with a real database has to arrive in the same state.
  const uid = userId || Number(session.data?.core?.userId?.() ?? 0);
  if (uid) await (appFake.db as Fake).table?.("usr")?.get?.(uid);
  for (const [k, v] of Object.entries(set ?? {}))
    Object.defineProperty(ctx, k, { value: v, configurable: true, writable: true });
  return ctx;
}

/** Drive an api tree over a Web `Request` and build the `Response` from the thrown `Output` signal. */
export async function apiRequest(tree: ApiTree, input: string, init?: RequestInit): Promise<Response> {
  const url = new URL(input, "http://qino.test");
  try {
    const req = await Req.create(new Request(url, init), { url });
    await apiFetch(req, tree, url.pathname);
  } catch (e) {
    if (e instanceof Output) return new Response(e.body as string, { status: e.status, headers: e.headers });
    return new Response(null, { status: 500 });
  }
  throw new Error("apiFetch did not signal");
}
