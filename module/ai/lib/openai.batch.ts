// deno-lint-ignore-file no-explicit-any
import { AiError } from "./request.ts";
import { auth, chatAnswer, chatBody, format, post } from "./openai.ts";

import type { EmbedInput, StructuredInput, TextInput } from "../mod.ts";
import type { BatchAnswer, BatchApi, BatchInput } from "./batch.ts";
import type { Call } from "./request.ts";

// Batch APIs of OpenAI-compatible providers, answered within 24 hours at about half the price:
// OpenAI's (the calls as a JSONL file) and OpenRouter's (the calls inline). Providers without one
// fail the submission; the batch goes elsewhere then (batch.ts).

/** Per capability: its endpoint, a call's body, and what an answer's body gives. */
const kinds: Record<string, { path: string; body: (call: Call, input: any) => unknown; answer: (body: any) => Omit<BatchAnswer, "id"> }> = {
  text: {
    path: "/chat/completions",
    body: (call, input: TextInput) => chatBody(call, { ...input, onText: undefined }),
    answer: (body) => ({ output: chatAnswer(body.choices[0].message, body.choices[0].finish_reason), usage: [body.usage?.prompt_tokens, body.usage?.completion_tokens] }),
  },
  // the schema can't be kept until the answer comes: it shapes the answer, the caller validates
  structured: {
    path: "/chat/completions",
    body: (call, { schema, ...input }: StructuredInput<unknown>) => chatBody(call, { ...input, onText: undefined }, format(schema)),
    answer: (body) => ({ output: JSON.parse(body.choices[0].message.content), usage: [body.usage?.prompt_tokens, body.usage?.completion_tokens] }),
  },
  embed: {
    path: "/embeddings",
    body: (call, input: EmbedInput) => {
      if (!input.texts) throw new AiError("This provider embeds text only");
      return { model: call.model, input: input.texts };
    },
    answer: (body) => ({ output: body.data.map((d: any) => d.embedding), usage: [body.usage?.prompt_tokens] }),
  },
};

function kindOf(capability: string) {
  if (!kinds[capability]) throw new AiError(`No batch for "${capability}"`);
  return kinds[capability];
}

/** An answer as both APIs give it: the call's id, its response or why there is none. */
const answer = (kind: typeof kinds[string], { custom_id: id, response, error }: any): BatchAnswer =>
  response?.status_code === 200 ? { id, ...kind.answer(response.body) }
    : { id, error: error?.message ?? response?.body?.error?.message ?? `HTTP ${response?.status_code}` };

const state = async (call: Call, handle: string) => (await call.fetch(`/batches/${handle}`, { headers: auth(call) })).json();

const ENDED = new Set(["completed", "expired", "cancelled", "failed"]);

/** OpenAI: upload the calls and start the batch; resolves to its id. */
async function batch(call: Call, { capability, items }: BatchInput): Promise<string> {
  const kind = kindOf(capability);
  const url = "/v1" + kind.path; // as the API names it, whatever the endpoint's own path
  const lines = items.map(({ id, input }) => JSON.stringify({ custom_id: id, method: "POST", url, body: kind.body(call, input) }));
  const form = new FormData();
  form.set("purpose", "batch");
  form.set("file", new File([lines.join("\n")], "batch.jsonl", { type: "application/jsonl" }));
  const file = await (await call.fetch("/files", { method: "POST", headers: auth(call), body: form })).json();
  return (await post(call, "/batches", { input_file_id: file.id, endpoint: url, completion_window: "24h" })).id;
}

/** OpenAI: the answers once the batch ended (undefined before), read line by line; a failed batch throws. */
async function batched(call: Call, { handle, capability }: { handle: string; capability: string }): Promise<AsyncIterable<BatchAnswer> | undefined> {
  const { status, output_file_id, error_file_id, input_file_id, errors } = await state(call, handle);
  if (!ENDED.has(status)) return;
  const files = [output_file_id, error_file_id].filter(Boolean);
  if (!files.length) throw new AiError(`Batch ${status}: ${errors?.data?.[0]?.message ?? "no answers"}`);
  return answers(call, kindOf(capability), files, input_file_id);
}

async function* answers(call: Call, kind: typeof kinds[string], files: string[], input: string) {
  for (const file of files) {
    for await (const line of lines(await call.fetch(`/files/${file}/content`, { headers: auth(call) }))) yield answer(kind, JSON.parse(line));
  }
  // the files count towards the account's storage
  for (const file of [...files, input]) await call.fetch(`/files/${file}`, { method: "DELETE", headers: auth(call) }).catch(() => {});
}

/** A response's lines, as they arrive: the answers of a large batch don't fit in memory at once. */
async function* lines(res: Response) {
  let buf = "";
  for await (const chunk of res.body!.pipeThrough(new TextDecoderStream())) {
    buf += chunk;
    const parts = buf.split("\n");
    buf = parts.pop()!;
    yield* parts.filter((line) => line.trim());
  }
  if (buf.trim()) yield buf;
}

/** OpenRouter: the calls inline, one model for all; resolves to the batch's id. */
async function openrouterBatch(call: Call, { capability, items }: BatchInput): Promise<string> {
  const kind = kindOf(capability);
  // `requests` last, as OpenRouter asks
  const body = { endpoint: "/v1" + kind.path, model: call.model, completion_window: "24h", requests: items.map(({ id, input }) => ({ custom_id: id, body: kind.body(call, input) })) };
  return (await post(call, "/batches", body)).id;
}

/** OpenRouter: the answers come with the ended batch, which is deleted then. */
async function openrouterBatched(call: Call, { handle, capability }: { handle: string; capability: string }): Promise<AsyncIterable<BatchAnswer> | undefined> {
  const { status, results } = await state(call, handle);
  if (!ENDED.has(status)) return;
  if (!results?.length) throw new AiError(`Batch ${status}: no answers`);
  const kind = kindOf(capability);
  return (async function* () {
    for (const result of results) yield answer(kind, result);
    await call.fetch(`/batches/${handle}`, { method: "DELETE", headers: auth(call) }).catch(() => {});
  })();
}

/** The batch APIs by provider type (`aiBatches`). */
export const openai: BatchApi = { batch, batched };
export const openrouter: BatchApi = { batch: openrouterBatch, batched: openrouterBatched };
