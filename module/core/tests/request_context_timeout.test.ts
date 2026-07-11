import { assertEquals, assert, testContext } from "./deps.ts";
import type { RequestContext } from "../lib/ctx/RequestContext.ts";
import { Output } from "../lib/util.ts";

function makeCtx(reqInit: RequestInit = {}): Promise<RequestContext> {
  return testContext({ url: "http://localhost/", ...reqInit });
}

Deno.test("deadline.left defaults to Infinity and signal stays quiet", async () => {
  const ctx = await makeCtx();
  assertEquals(ctx.req.deadline.left, Infinity);
  assertEquals(ctx.req.deadline.signal.aborted, false);
});

Deno.test("deadline.left counts down and supports += extension", async () => {
  const ctx = await makeCtx();
  ctx.req.deadline.left = 30;
  assert(ctx.req.deadline.left > 29 && ctx.req.deadline.left <= 30);
  ctx.req.deadline.left += 60;
  assert(ctx.req.deadline.left > 89 && ctx.req.deadline.left <= 90);
  ctx.req.deadline.left = Infinity; // lift the limit again, clears the timer
  assertEquals(ctx.req.deadline.left, Infinity);
  await ctx.req.cleanup();
});

Deno.test("Infinity += n stays unlimited", async () => {
  const ctx = await makeCtx();
  ctx.req.deadline.left += 99;
  assertEquals(ctx.req.deadline.left, Infinity);
  assertEquals(ctx.req.deadline.signal.aborted, false);
  await ctx.req.cleanup();
});

Deno.test("expired deadline aborts the signal with a 504 Output", async () => {
  const ctx = await makeCtx();
  const aborted = new Promise<void>(r => ctx.req.deadline.signal.addEventListener("abort", () => r(), { once: true }));
  ctx.req.deadline.left = 0.01;
  await aborted;
  assert(ctx.req.deadline.signal.aborted);
  assert(ctx.req.deadline.signal.reason instanceof Output);
  assertEquals((ctx.req.deadline.signal.reason as Output).status, 504);
  assertEquals(ctx.req.deadline.left, 0);
  await ctx.req.cleanup();
});

Deno.test("client disconnect aborts deadline.signal too", async () => {
  const ctrl = new AbortController();
  const ctx = await makeCtx({ signal: ctrl.signal });
  assertEquals(ctx.req.deadline.signal.aborted, false);
  ctrl.abort();
  assert(ctx.req.deadline.signal.aborted);
  await ctx.req.cleanup();
});

Deno.test("cleanup clears a pending timeout timer", async () => {
  const ctx = await makeCtx();
  ctx.req.deadline.left = 60; // would leak a timer without cleanup (deno test leak detector)
  await ctx.req.cleanup();
});
