export { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
// Not in mod.ts on purpose — App and Db extend it, nobody else needs to construct one.
export { Emitter } from "../lib/Emitter.ts";
export { fakeRender } from "./sqlFake.ts";
export { fakeT } from "./appFake.ts";

import { apiFetch, type ApiTree } from "../lib/api/mod.ts";
import { Req } from "../lib/ctx/Req.ts";
import { Ctx } from "../lib/ctx/Ctx.ts";
import { Output } from "../lib/util.ts";

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
  const session = sess ?? { data: { core: { userId: () => userId } } };
  const appFake = {
    sessions: { loadFromRequest: () => session },
    trustedProxyHops: 0,
    ...app,
    settings: { core: {}, ...app.settings },
  };
  const ctx = await Ctx.create(appFake as never, new Request(url, reqInit), { appUrl });
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
