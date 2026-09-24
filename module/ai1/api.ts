// deno-lint-ignore-file no-explicit-any
import { Access, ApiError, Output, s } from "@qino/qino";

import { AiError } from "./lib/run.ts";
import { decide, embed, image, text, translate } from "./mod.ts";

import type { ApiTree, Ctx, Params } from "@qino/qino";

// The capabilities for the browser, shaped like their functions. Any signed-in user may call them.

const opts = s.optional(s.object({ model: s.optional(s.string()), prefer: s.optional(s.string()) }));
const textInput = {
  messages: s.array(s.record()),
  tools: s.optional(s.array(s.record())),
  temperature: s.optional(s.number()),
  maxTokens: s.optional(s.number()),
  opts,
};

/** Provider failures are the upstream's, not the request's. */
const upstream = <T>(promise: Promise<T>): Promise<T> =>
  promise.catch((e) => { throw e instanceof AiError ? new ApiError(e.status === 504 ? 504 : 502, e.message) : e; });

const post = (description: string, input: Record<string, any>, run: (params: Params, ctx: Ctx) => Promise<unknown>) => ({
  post: { description, input: s.object(input), access: Access.USER, execute: (params: Params, ctx: Ctx) => upstream(run(params, ctx)) },
});

export const api: ApiTree = {
  text: {
    ...post("Answer the messages", textInput, ({ opts, ...input }, ctx) => text(ctx.app, input as any, opts as any)),
    stream: post("Answer the messages as a stream (SSE): { delta } events, then { done } or { error }", textInput, ({ opts, ...input }, ctx) => {
      const encoder = new TextEncoder();
      throw new Output(new ReadableStream({
        start: async (out) => {
          const send = (data: unknown) => out.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          await text(ctx.app, { ...input as any, onText: (delta: string) => send({ delta }) }, opts as any)
            .then((done) => send({ done }), (e) => send({ error: e.message }));
          out.close();
        },
      }), { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-store", "x-accel-buffering": "no" } });
    }),
  },
  translate: post("Translate a text", {
    text: s.string(), to: s.string(), from: s.optional(s.string()), format: s.optional(s.string()), opts,
  }, ({ opts, ...input }, ctx) => translate(ctx.app, input as any, opts as any)),
  decide: post("Pick one of the options (classify, route, judge)", {
    text: s.string(), question: s.optional(s.string()), options: s.array(s.string()), opts,
  }, ({ opts, ...input }, ctx) => decide(ctx.app, input as any, opts as any)),
  embed: post("Embedding vectors for texts", { texts: s.array(s.string()), opts }, ({ opts, ...input }, ctx) => embed(ctx.app, input as any, opts as any)),
  image: post("Generate images; URLs or data URLs", {
    prompt: s.string(), size: s.optional(s.string()), n: s.optional(s.number()), opts,
  }, ({ opts, ...input }, ctx) => image(ctx.app, input as any, opts as any)),
};
