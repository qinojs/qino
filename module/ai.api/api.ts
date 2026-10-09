// deno-lint-ignore-file no-explicit-any
import { Access, ApiError, Output, s } from "@qino/qino";
import * as ai1 from "@qino/qino/ai1";

import type { ApiTree, Ctx, Params } from "@qino/qino";

// The capabilities for the browser, shaped like their functions. Any signed-in user may call them.

const opts = s.optional(s.object({ model: s.optional(s.string()), prefer: s.optional(s.record(s.number())) }));
const answer = { messages: s.array(s.record()), temperature: s.optional(s.number()), maxTokens: s.optional(s.number()) };
const textInput = { ...answer, tools: s.optional(s.array(s.record())) };

/** Provider failures are the upstream's, not the request's. */
const upstream = <T>(promise: Promise<T>): Promise<T> =>
  promise.catch((e) => { throw e instanceof ai1.AiError ? new ApiError(e.status === 504 ? 504 : 502, e.message) : e; });

const post = (description: string, input: Record<string, any>, handle: (params: Params, ctx: Ctx) => Promise<unknown>) => ({
  post: { description, input: s.object(input), access: Access.USER, execute: (params: Params, ctx: Ctx) => upstream(handle(params, ctx)) },
});
/** An endpoint for a capability: the body is the input of its function in ai1, plus `opts`. */
type Fn = (app: any, input: any, opts?: any) => Promise<unknown>;
const capability = (fn: Fn, description: string, input: Record<string, any>) =>
  post(description, { ...input, opts }, ({ opts, ...input }, ctx) => fn(ctx.app, input, opts));

export const api: ApiTree = {
  text: {
    ...capability(ai1.text, "Answer the messages", textInput),
    stream: post("Answer the messages as a stream (SSE): { delta } events, then { done } or { error }", { ...textInput, opts }, ({ opts, ...input }, ctx) => {
      const encoder = new TextEncoder(), abort = new AbortController(); // a closed connection cancels the call
      throw new Output(new ReadableStream({
        start: async (out) => {
          const send = (data: unknown) => abort.signal.aborted || out.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          const onText = (delta: string) => send({ delta });
          await ai1.text(ctx.app, { ...input as any, onText }, { ...opts as any, signal: abort.signal })
            .then((done) => send({ done }), (e) => send({ error: e.message }));
          if (!abort.signal.aborted) out.close();
        },
        cancel: () => abort.abort(),
      }), { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-store", "x-accel-buffering": "no" } });
    }),
  },
  structured: capability(ai1.structured, "A structured answer: JSON in the shape of a JSON Schema", {
    ...answer,
    schema: s.record(),
  }),
  translate: post("Translate one text or many (text: string or string[])", {
    text: s.any(), to: s.string(), from: s.optional(s.string()), format: s.optional(s.string()), opts,
  }, ({ opts, ...input }, ctx) => {
    if (typeof input.text !== "string" && !(Array.isArray(input.text) && input.text.every((t) => typeof t === "string"))) throw new ApiError(400, "text: a string or strings");
    return ai1.translate(ctx.app, input as any, opts as any);
  }),
  decide: post(
    "Pick one of the options (classify, route, judge); without options a yes/no question. content: a string or " +
      "parts with images. Returns { choice, probabilities, confidence }",
    {
      content: s.any(),
      question: s.optional(s.string()),
      options: s.optional(s.any()).describe("Names, or { name: what it means }; none: yes/no"),
      opts,
    },
    ({ opts, ...input }, ctx) => ai1.decide(ctx.app, input as any, opts as any),
  ),
  embed: post("Embedding vectors for texts", { texts: s.array(s.string()), purpose: s.optional(s.string()), opts }, ({ opts, purpose, texts }, ctx) => {
    if (purpose !== undefined && purpose !== "index" && purpose !== "query") throw new ApiError(400, "purpose: index or query");
    return ai1.embed(ctx.app, { texts, purpose } as ai1.EmbedInput, opts as any);
  }),
  image: capability(ai1.image, "Generate images; URLs or data URLs", {
    prompt: s.string(),
    size: s.optional(s.string()),
    n: s.optional(s.number()),
  }),
  speak: capability(ai1.speak, "Text to speech; the audio as a data URL", {
    text: s.string(),
    voice: s.optional(s.string()),
    format: s.optional(s.string()),
  }),
};
