// deno-lint-ignore-file no-explicit-any
import { errMsg } from "@qino/qino";

import { AiError } from "./request.ts";
import { systemone } from "./decide.ts";
import { jsonSchema, parseStructured } from "./capabilities.ts";

import type { Transcript } from "@qino/qino";
import type { EmbedInput, Message, Part, StructuredInput, TextInput, TextOutput } from "../mod.ts";
import type { Adapter, Call } from "./request.ts";

// OpenAI-compatible providers: OpenAI itself, groq, Gemini's compat endpoint, local servers.

const auth = (call: Call): Record<string, string> => call.key ? { authorization: "Bearer " + call.key } : {};

const request = (call: Call, path: string, body: unknown) =>
  call.fetch(path, { method: "POST", headers: { ...auth(call), "content-type": "application/json" }, body: JSON.stringify(body) });

const post = async (call: Call, path: string, body: unknown) => (await request(call, path, body)).json();

/** The vectors of an `/embeddings` call; the body differs by provider. */
export const vectors = async (call: Call, body: unknown): Promise<number[][]> => {
  const data = await post(call, "/embeddings", body);
  call.usage(data.usage?.prompt_tokens);
  return data.data.map((d: any) => d.embedding);
};

/** Generated images as URLs: the provider's, or data URLs of the bytes. */
const urls = (call: Call, prompt: string, data: any): string[] => {
  const images = data.data.map((d: any) => d.url ?? `data:${d.media_type ?? "image/png"};base64,${d.b64_json}`);
  call.usage(prompt.length, images.length);
  return images;
};

const json = (value: string) => { try { return JSON.parse(value); } catch { return value; } };

const toOpenAi = (m: Message) =>
  m.role === "tool" ? { role: "tool", tool_call_id: m.id, content: m.content }
  : m.role === "assistant" ? { ...m, toolCalls: undefined, ...(m.toolCalls?.length && { tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.args) }, ...tc.extra_content && { extra_content: tc.extra_content } })) }) }
  : { role: m.role, content: typeof m.content === "string" ? m.content : m.content.map((p) => p.type === "text" ? p : { type: "image_url", image_url: { url: p.url } }) };

// A system message amid the history goes as the user's, marked: not every model takes one there
// (Anthropic moves it to the start, some chat templates reject it).
const note = (content: string | Part[]): Message => ({
  role: "user",
  content: typeof content === "string" ? `<system-reminder>\n${content}\n</system-reminder>` : [{ type: "text", text: "<system-reminder>" }, ...content, { type: "text", text: "</system-reminder>" }],
});

/** `more` goes into the request as it is: a response format, a cache mark. */
async function text(call: Call, { messages, tools, temperature, maxTokens, onText }: TextInput, more: Record<string, unknown> = {}): Promise<Omit<TextOutput, "model" | "modelProvider">> {
  const start = messages.findIndex((m) => m.role !== "system");
  const body = {
    model: call.model,
    messages: messages.map((m, i) => toOpenAi(m.role === "system" && i > start && start >= 0 ? note(m.content) : m)),
    tools: tools?.length ? tools.map(({ name, description, parameters }) => ({ type: "function", function: { name, description, parameters } })) : undefined,
    temperature,
    max_tokens: maxTokens,
    ...(onText && { stream: true, stream_options: { include_usage: true } }),
    ...more,
  };
  const res = await request(call, "/chat/completions", body).catch((e) => {
    // not merged yet: a late system note right after a user message makes two in a row
    const twice = body.messages.some((m, i) => i && m.role === "user" && body.messages[i - 1].role === "user");
    throw e.status === 400 && twice ? new AiError(`${e.message} (maybe two user messages in a row: merge them in ai1's toOpenAi)`, 400) : e;
  });
  const { message, usage, finish } = onText
    ? await stream(res, onText)
    : await res.json().then((data) => ({ message: data.choices?.[0]?.message, usage: data.usage, finish: data.choices?.[0]?.finish_reason }));
  if (!message) throw new AiError(`No answer from "${call.provider}"`);
  call.usage(usage?.prompt_tokens, usage?.completion_tokens);
  const toolCalls = (message.tool_calls ?? []).map((tc: any) => ({ id: tc.id, name: tc.function.name, args: json(tc.function.arguments || "{}"), ...tc.extra_content && { extra_content: tc.extra_content } }));
  return { text: message.content ?? "", toolCalls, truncated: finish === "length" };
}

// Collect a streamed answer: content deltas go to `onText`, tool-call fragments are joined by index.
async function stream(res: Response, onText: (delta: string) => void) {
  let content = "", usage, finish: string | undefined;
  const toolCalls: any[] = [];
  try {
    const done = await readSse(res, (data) => {
      if (data.usage) usage = data.usage;
      finish = data.choices?.[0]?.finish_reason ?? finish;
      const delta = data.choices?.[0]?.delta;
      if (delta?.content) {
        content += delta.content;
        onText(delta.content);
      }
      for (const tc of delta?.tool_calls ?? []) {
        const slot = toolCalls[tc.index ?? 0] ??= { id: tc.id, function: { name: "", arguments: "" } };
        slot.function.name += tc.function?.name ?? "";
        slot.function.arguments += tc.function?.arguments ?? "";
        if (tc.extra_content) slot.extra_content = tc.extra_content;
      }
    });
    if (!finish && !done) throw new AiError("Incomplete stream");
  } catch (e) {
    throw new AiError(errMsg(e), (e as AiError).status, !!content);
  }
  return { message: { content, tool_calls: toolCalls.filter(Boolean) }, usage, finish };
}

async function readSse(res: Response, onData: (data: any) => void): Promise<boolean> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buf += (value ?? "").replaceAll("\r", "") + (done ? "\n\n" : ""); // flush a trailing event on end
      let end: number;
      while ((end = buf.indexOf("\n\n")) >= 0) {
        for (const line of buf.slice(0, end).split("\n")) {
          const data = line.match(/^data:\s?(.*)$/)?.[1];
          if (data === "[DONE]") return true;
          if (data !== undefined) {
            let event;
            try { event = JSON.parse(data); }
            catch { throw new AiError("Invalid stream event"); }
            onData(event);
          }
        }
        buf = buf.slice(end + 2);
      }
      if (done) return false;
    }
  } finally {
    await reader.cancel().catch(() => {}); // `[DONE]` returns mid-stream, the body stays open otherwise
  }
}

const format = (schema: StructuredInput<unknown>["schema"]) =>
  ({ response_format: { type: "json_schema", json_schema: { name: "output", schema: jsonSchema(schema) } } });

export const openai: Adapter = {
  text: (call, input: TextInput) => text(call, input),
  structured: async (call, { schema, ...input }: StructuredInput<unknown>) => parseStructured((await text(call, input, format(schema))).text, schema),
  embed: async (call, input: EmbedInput) => {
    if (!input.texts) throw new AiError("This provider embeds text only");
    return await vectors(call, { model: call.model, input: input.texts });
  },
  image: async (call, { prompt, size, n }: { prompt: string; size?: string; n?: number }) => urls(call, prompt, await post(call, "/images/generations", { model: call.model, prompt, size, n })),
  speak: async (call, { text, voice, format }: { text: string; voice?: string; format?: string }) => {
    const res = await request(call, "/audio/speech", { model: call.model, input: text, voice: voice ?? "alloy", response_format: format ?? "mp3" });
    call.usage(text.length);
    const type = res.headers.get("content-type")?.split(";")[0] ?? "audio/mpeg";
    return `data:${type};base64,${new Uint8Array(await res.arrayBuffer()).toBase64()}`;
  },
  transcribe: async (call, { file, language }: { file: File; language?: string }): Promise<Transcript> => {
    const send = (verbose: boolean) => {
      const body = new FormData();
      body.set("file", file);
      body.set("model", call.model);
      if (verbose) body.set("response_format", "verbose_json");
      if (language) body.set("language", language);
      return call.fetch("/audio/transcriptions", { method: "POST", headers: auth(call), body });
    };
    // verbose_json brings the timestamps, but not every model takes it (gpt-4o-transcribe)
    const res = await send(true).catch((e) => e instanceof AiError && e.status === 400 ? send(false) : Promise.reject(e));
    const data = await res.json();
    call.usage(Math.ceil(data.duration ?? 0));
    const text = String(data.text ?? "");
    const segments = data.segments?.map(({ start, end, text }: any) => ({ start, end, text })) ?? [{ text }];
    return { kind: "qino.transcript", version: 1, text, language: data.language, segments };
  },
};

// OpenRouter caches only when asked (Anthropic); the mark at the top caches up to the last message.
const cache = (input: TextInput) => input.cache ? { cache_control: { type: "ephemeral" } } : {};

/** OpenRouter: OpenAI-compatible, but images at /images, and decision models (TypeSafe Jev) through
 *  its System One API. */
export const openrouter: Adapter = {
  ...openai,
  text: (call, input: TextInput) => text(call, input, cache(input)),
  structured: async (call, { schema, ...input }: StructuredInput<unknown>) =>
    parseStructured((await text(call, input, { ...format(schema), ...cache(input) })).text, schema),
  image: async (call, { prompt, n }: { prompt: string; n?: number }) => urls(call, prompt, await post(call, "/images", { model: call.model, prompt, n })),
  decide: systemone.decide,
};
