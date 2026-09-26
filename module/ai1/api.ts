// deno-lint-ignore-file no-explicit-any
import { Access, ApiError, Output, s } from "@qino/qino";

import { check } from "./lib/limit.ts";
import { AiError } from "./lib/run.ts";
import { run } from "./mod.ts";

import type { ApiTree, Ctx, Params } from "@qino/qino";

// The capabilities for the browser, shaped like their functions. Any signed-in user may call them,
// up to the daily limit (settings ai1.dailyLimit).

const opts = s.optional(s.object({ model: s.optional(s.string()), prefer: s.optional(s.record(s.number())) }));
const answer = { messages: s.array(s.record()), temperature: s.optional(s.number()), maxTokens: s.optional(s.number()) };
const textInput = { ...answer, tools: s.optional(s.array(s.record())) };

/** Provider failures are the upstream's, not the request's. */
const upstream = <T>(promise: Promise<T>): Promise<T> =>
  promise.catch((e) => { throw e instanceof AiError ? new ApiError(e.status === 504 ? 504 : 502, e.message) : e; });

const post = (description: string, input: Record<string, any>, run: (params: Params, ctx: Ctx) => Promise<unknown>) => ({
  post: { description, input: s.object(input), access: Access.USER, execute: async (params: Params, ctx: Ctx) => (await check(ctx), upstream(run(params, ctx))) },
});
/** An endpoint for a capability: the body is its input, plus `opts`. */
const capability = (name: string, description: string, input: Record<string, any>) =>
  post(description, { ...input, opts }, ({ opts, ...input }, ctx) => run(ctx.app, name, input, opts as any));

export const api: ApiTree = {
  text: {
    ...capability("text", "Answer the messages", textInput),
    stream: post("Answer the messages as a stream (SSE): { delta } events, then { done } or { error }", { ...textInput, opts }, ({ opts, ...input }, ctx) => {
      const encoder = new TextEncoder();
      throw new Output(new ReadableStream({
        start: async (out) => {
          const send = (data: unknown) => out.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          await run(ctx.app, "text", { ...input, onText: (delta: string) => send({ delta }) }, opts as any)
            .then((done) => send({ done }), (e) => send({ error: e.message }));
          out.close();
        },
      }), { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-store", "x-accel-buffering": "no" } });
    }),
  },
  structured: capability("structured", "A structured answer: JSON in the shape of a JSON Schema", { ...answer, schema: s.record() }),
  translate: post("Translate one text or many (text: string or string[])", {
    text: s.any(), to: s.string(), from: s.optional(s.string()), format: s.optional(s.string()), opts,
  }, ({ opts, ...input }, ctx) => {
    if (typeof input.text !== "string" && !(Array.isArray(input.text) && input.text.every((t) => typeof t === "string"))) throw new ApiError(400, "text: a string or strings");
    return run(ctx.app, "translate", input, opts as any);
  }),
  decide: capability("decide", "Pick one of the options (classify, route, judge); content: a string or parts with images", {
    content: s.any(), question: s.optional(s.string()), options: s.array(s.string()),
  }),
  embed: post("Embedding vectors for texts", { texts: s.array(s.string()), purpose: s.optional(s.string()), opts }, ({ opts, purpose, texts }, ctx) => {
    if (purpose !== undefined && purpose !== "index" && purpose !== "query") throw new ApiError(400, "purpose: index or query");
    return run(ctx.app, "embed", { texts, purpose }, opts as any);
  }),
  image: capability("image", "Generate images; URLs or data URLs", { prompt: s.string(), size: s.optional(s.string()), n: s.optional(s.number()) }),
  speak: capability("speak", "Text to speech; the audio as a data URL", { text: s.string(), voice: s.optional(s.string()), format: s.optional(s.string()) }),
};
