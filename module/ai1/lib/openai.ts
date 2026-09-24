// deno-lint-ignore-file no-explicit-any
import { errMsg, toJsonSchema } from "@qino/qino";

import { AiError } from "./run.ts";
import { parseObject } from "./tasks.ts";

import type { Transcript } from "@qino/qino";
import type { Message, ObjectInput, TextInput, TextOutput } from "../mod.ts";
import type { Adapter, Call } from "./run.ts";

// OpenAI-compatible providers: OpenAI itself, groq, openrouter, Gemini's compat endpoint, local servers.

const auth = (call: Call): Record<string, string> => call.key ? { authorization: "Bearer " + call.key } : {};

const request = (call: Call, path: string, body: unknown) =>
  call.fetch(path, { method: "POST", headers: { ...auth(call), "content-type": "application/json" }, body: JSON.stringify(body) });

const post = async (call: Call, path: string, body: unknown) => (await request(call, path, body)).json();

const json = (value: string) => { try { return JSON.parse(value); } catch { return value; } };

const toOpenAi = (m: Message) =>
  m.role === "tool" ? { role: "tool", tool_call_id: m.id, content: m.content }
  : m.role === "assistant" ? { ...m, toolCalls: undefined, ...(m.toolCalls?.length && { tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.args) } })) }) }
  : { role: m.role, content: typeof m.content === "string" ? m.content : m.content.map((p) => p.type === "text" ? p : { type: "image_url", image_url: { url: p.url } }) };

async function text(call: Call, { messages, tools, temperature, maxTokens, onText }: TextInput, format?: unknown): Promise<TextOutput> {
  const body = {
    model: call.model,
    messages: messages.map(toOpenAi),
    tools: tools?.length ? tools.map(({ name, description, parameters }) => ({ type: "function", function: { name, description, parameters } })) : undefined,
    response_format: format ? { type: "json_schema", json_schema: { name: "output", schema: format } } : undefined,
    temperature,
    max_tokens: maxTokens,
    ...(onText && { stream: true, stream_options: { include_usage: true } }),
  };
  const res = await request(call, "/chat/completions", body);
  const { message, usage, finish } = onText
    ? await stream(res, onText)
    : await res.json().then((data) => ({ message: data.choices?.[0]?.message, usage: data.usage, finish: data.choices?.[0]?.finish_reason }));
  if (!message) throw new AiError(`No answer from "${call.provider}"`);
  const input = usage?.prompt_tokens ?? 0, output = usage?.completion_tokens ?? 0;
  call.usage(input, output);
  const toolCalls = (message.tool_calls ?? []).map((tc: any) => ({ id: tc.id, name: tc.function.name, args: json(tc.function.arguments || "{}") }));
  return { text: message.content ?? "", toolCalls, truncated: finish === "length", usage: { input, output } };
}

// Collect a streamed answer: content deltas go to `onText`, tool-call fragments are joined by index.
async function stream(res: Response, onText: (delta: string) => void) {
  let content = "", usage, finish: string | undefined;
  const toolCalls: any[] = [];
  try {
    await readSse(res, (data) => {
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
      }
    });
  } catch (e) {
    throw new AiError(errMsg(e), (e as AiError).status, !!content);
  }
  return { message: { content, tool_calls: toolCalls.filter(Boolean) }, usage, finish };
}

async function readSse(res: Response, onData: (data: any) => void): Promise<void> {
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
          if (data === "[DONE]") return;
          if (data) try { onData(JSON.parse(data)); } catch { /* keepalive / non-json */ }
        }
        buf = buf.slice(end + 2);
      }
      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => {}); // `[DONE]` returns mid-stream, the body stays open otherwise
  }
}

export const openai: Adapter = {
  text: (call, input: TextInput) => text(call, input),
  object: async (call, { schema, ...input }: ObjectInput<unknown>) => parseObject((await text(call, input, toJsonSchema(schema))).text, schema),
  embed: async (call, { texts }: { texts: string[] }) => {
    const data = await post(call, "/embeddings", { model: call.model, input: texts });
    call.usage(data.usage?.prompt_tokens);
    return data.data.map((d: any) => d.embedding);
  },
  image: async (call, { prompt, size, n }: { prompt: string; size?: string; n?: number }) => {
    const data = await post(call, "/images/generations", { model: call.model, prompt, size, n });
    return data.data.map((d: any) => d.url ?? `data:image/png;base64,${d.b64_json}`);
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
