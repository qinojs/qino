export { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@^1";

import { aptFetch, type AptTree } from "../lib/apt/mod.ts";
import { Req } from "../lib/ctx/Req.ts";
import { Output } from "../lib/util.ts";

/** Drive an apt tree over a Web `Request` and build the `Response` from the thrown `Output` signal. */
export async function aptRequest(tree: AptTree, input: string, init?: RequestInit): Promise<Response> {
  const url = new URL(input, "http://qino.test");
  const req = new Req(new Request(url, init));
  try {
    await aptFetch(req, tree, url.pathname);
  } catch (e) {
    if (e instanceof Output) return new Response(e.body as string, { status: e.status, headers: e.headers });
    return new Response(null, { status: 500 });
  }
  throw new Error("aptFetch did not signal");
}
