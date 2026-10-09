import { errMsg, requestStorage } from "@qino/qino";
import { AiError, readSse } from "@qino/qino/ai";

import { active } from "./account.ts";

import type { Adapter, Message, Part, TextInput, TextOutput } from "@qino/qino/ai";

type Call = Parameters<Adapter["text"]>[0];

type Item = Record<string, unknown>;
type Answer = { output?: Item[]; usage?: { input_tokens?: number; output_tokens?: number }; status?: string;
  error?: { code?: string; message?: string }; incomplete_details?: { reason?: string } };

function content(value: string | Part[], output = false) {
  const parts = typeof value === "string" ? [{ type: "text", text: value } as Part] : value;
  return parts.map((part) => part.type === "text"
    ? { type: output ? "output_text" : "input_text", text: part.text }
    : { type: "input_image", image_url: part.url });
}

export function input(messages: Message[], tools: TextInput["tools"]): { input: Item[]; instructions?: string } {
  const items: Item[] = [];
  const leading: string[] = [];
  let started = false;
  if (tools?.length) items.push({ type: "additional_tools", role: "developer", tools: tools.map(({ name, description, parameters }) =>
    ({ type: "function", name, description, parameters })) });
  for (const message of messages) {
    if (message.role === "system" && !started) { leading.push(typeof message.content === "string" ? message.content :
      message.content.filter((p) => p.type === "text").map((p) => p.text).join("\n")); continue; }
    started = true;
    if (message.role === "tool") { items.push({ type: "function_call_output", call_id: message.id, output: message.content }); continue; }
    if (message.role === "assistant") {
      if (message.content) items.push({ role: "assistant", content: content(message.content, true) });
      for (const tool of message.toolCalls ?? []) items.push({ type: "function_call", call_id: tool.id,
        name: tool.name, arguments: JSON.stringify(tool.args) });
      continue;
    }
    items.push({ role: message.role === "system" ? "developer" : "user", content: content(message.content) });
  }
  return { input: items, ...(leading.length && { instructions: leading.join("\n\n") }) };
}

export async function completed(response: Response, onText?: (delta: string) => void): Promise<Answer> {
  if (!response.body) throw new AiError("Empty ChatGPT response", 502);
  let answer: Answer | undefined, streamed = false;
  const items = new Map<number, Item>();
  try {
    await readSse(response, (part) => {
      if (part.type === "response.output_text.delta" && typeof part.delta === "string") {
        streamed = true;
        onText?.(part.delta);
      }
      const done = part.type === "response.output_item.done" && typeof part.output_index === "number";
      if (done && part.item && typeof part.item === "object") items.set(part.output_index, part.item);
      if (part.type === "response.completed") answer = part.response;
      if (part.type === "response.failed" || part.type === "response.incomplete") {
        const response = part.response as Answer | undefined;
        const reason = part.type === "response.failed"
          ? [response?.error?.code, response?.error?.message].filter(Boolean).join(": ")
          : response?.incomplete_details?.reason;
        throw new AiError(`ChatGPT ${part.type}${reason ? `: ${reason}` : ""}`, 502);
      }
    });
    if (!answer || answer.status !== "completed") throw new AiError("Incomplete ChatGPT stream", 502);
  } catch (e) {
    // text went out already: no other model may take over (as with the openai adapter)
    throw new AiError(errMsg(e), (e as AiError).status ?? 502, streamed);
  }
  return { ...answer, output: answer.output?.length ? answer.output : [...items].sort(([a], [b]) => a - b).map(([, item]) => item) };
}

async function text(call: Call, value: TextInput): Promise<Omit<TextOutput, "model" | "modelProvider">> {
  if (call.endpoint.replace(/\/+$/, "") !== "https://api.openai.com/v1")
    throw new AiError("The ChatGPT plan endpoint must be https://api.openai.com/v1", 400);
  const ctx = requestStorage.getStore();
  if (!ctx?.userId) throw new AiError("A signed-in Qino user is required for ChatGPT plan use", 401);
  const account = await active(ctx.app, ctx.userId);
  if (!account) throw new AiError("Connect a ChatGPT account at /ai-chatgpt", 401);
  const body = { model: call.model, ...input(value.messages, value.tools), store: false, stream: true };
  const response = await call.fetch("/responses", { method: "POST", headers: {
    authorization: `Bearer ${account.access_token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const answer = await completed(response, value.onText);
  call.usage(answer.usage?.input_tokens, answer.usage?.output_tokens);
  const text = (answer.output ?? []).filter((item) => item.type === "message")
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .filter((part) => part?.type === "output_text").map((part) => String(part.text ?? "")).join("");
  const toolCalls = (answer.output ?? []).filter((item) => item.type === "function_call").map((item) => {
    let args: unknown;
    try { args = JSON.parse(String(item.arguments ?? "{}")); }
    catch { throw new AiError("Invalid ChatGPT function arguments", 502); }
    return { id: String(item.call_id ?? ""), name: String(item.name ?? ""), args };
  });
  return { text, toolCalls, truncated: false };
}

export const chatgpt: Adapter = { text };
