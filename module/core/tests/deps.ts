export { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@^1";

import { aptFetch, type AptTree } from "../lib/apt/mod.ts";
import { ContextRequest } from "../lib/ctx/ContextRequest.ts";
import { RequestContext } from "../lib/ctx/RequestContext.ts";
import { Output } from "../lib/util.ts";

// deno-lint-ignore no-explicit-any
type Fake = Record<string, any>;

export interface TestContextInit extends RequestInit {
  url?: string;
  /** Mount prefix, default "/". */
  basePath?: string;
  /** Partial `App` fake, merged over the built-in minimal one. */
  app?: Fake;
  /** Partial `Session` fake; default is a guest session driven by `userId`. */
  sess?: Fake;
  userId?: number;
  /** Force-assigned ctx fields, shadowing prototype getters (e.g. `post`). */
  set?: Fake;
}

/** Build a RequestContext through the production `RequestContext.create()` path. */
export async function testContext(init: TestContextInit = {}): Promise<RequestContext> {
  const { url = "http://qino.test/", basePath = "/", app = {}, sess, userId = 0, set, ...reqInit } = init;
  const session = sess ?? { data: { core: { userId: () => userId } } };
  const appFake = {
    sessions: { loadFromRequest: () => session },
    trustedProxyHops: 0,
    ...app,
    settings: { core: {}, ...app.settings },
  };
  const ctx = await RequestContext.create(appFake as never, new Request(url, reqInit), { basePath });
  for (const [k, v] of Object.entries(set ?? {}))
    Object.defineProperty(ctx, k, { value: v, configurable: true, writable: true });
  return ctx;
}

/** Drive an apt tree over a Web `Request` and build the `Response` from the thrown `Output` signal. */
export async function aptRequest(tree: AptTree, input: string, init?: RequestInit): Promise<Response> {
  const url = new URL(input, "http://qino.test");
  try {
    const req = await ContextRequest.create(new Request(url, init), { url });
    await aptFetch(req, tree, url.pathname);
  } catch (e) {
    if (e instanceof Output) return new Response(e.body as string, { status: e.status, headers: e.headers });
    return new Response(null, { status: 500 });
  }
  throw new Error("aptFetch did not signal");
}
