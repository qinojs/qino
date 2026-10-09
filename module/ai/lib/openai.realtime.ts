// deno-lint-ignore-file no-explicit-any
import { errMsg } from "@qino/qino";

import { AiError } from "./request.ts";

import type { LiveInput, LiveOutput, Message } from "../mod.ts";
import type { Call } from "./request.ts";

// OpenAI's Realtime API. The server posts the browser's offer with the session (instructions, tools),
// so neither reaches the browser; the media then flow between browser and OpenAI. A sideband WebSocket
// on the same call brings what is said and the tool calls here.

/** What transcribes the user's words for the record. */
const TRANSCRIBE = "gpt-4o-mini-transcribe";

const json = (text: string) => { try { return JSON.parse(text); } catch { return text; } };

export async function live(call: Call, input: LiveInput): Promise<LiveOutput> {
  const { sdp, instructions, tools, voice, onToolCall, onMessage } = input;
  const auth = { authorization: "Bearer " + call.key };
  const body = new FormData();
  body.set("sdp", sdp);
  body.set("session", JSON.stringify({
    type: "realtime", model: call.model, instructions,
    tools: tools?.map(({ name, description, parameters }) => ({ type: "function", name, description, parameters })),
    audio: { input: { transcription: { model: TRANSCRIBE } }, ...voice && { output: { voice } } },
  }));
  const res = await call.fetch("/realtime/calls", { method: "POST", headers: auth, body });
  const id = res.headers.get("location")?.split("/").pop(), answer = await res.text();
  if (!id) throw new AiError("No call id from OpenAI");

  const url = `${call.endpoint.replace(/^http/, "ws").replace(/\/+$/, "")}/realtime?call_id=${encodeURIComponent(id)}`;
  const ws = new WebSocket(url, { headers: auth } as unknown as string[]); // Deno, Bun and Node take headers
  const send = (event: unknown) => ws.send(JSON.stringify(event));
  // one event after the other, as they come: the record keeps their order
  let queue: Promise<unknown> = Promise.resolve();
  ws.onmessage = (e) => queue = queue.then(() => handle(JSON.parse(String(e.data))))
    .catch((e) => console.error("[ai] live:", errMsg(e)));

  async function handle(event: Record<string, any>) {
    if (event.type === "error") return console.error("[ai] live:", event.error?.message);
    if (event.type === "conversation.item.input_audio_transcription.completed") {
      return await onMessage?.({ role: "user", content: String(event.transcript ?? "").trim() });
    }
    if (event.type !== "response.done") return;
    const output: Record<string, any>[] = event.response?.output ?? [];
    const said = output.filter((item) => item.type === "message").flatMap((item) => item.content ?? [])
      .map((part) => part.transcript ?? part.text ?? "").join("");
    const toolCalls = output.filter((item) => item.type === "function_call")
      .map((item) => ({ id: String(item.call_id), name: String(item.name), args: json(item.arguments || "{}") }));
    if (said || toolCalls.length) {
      await onMessage?.({ role: "assistant", content: said, ...toolCalls.length && { toolCalls } } as Message);
    }
    for (const { id, ...call } of toolCalls) {
      const result = await onToolCall({ id, ...call });
      await onMessage?.({ role: "tool", id, content: result });
      send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: id, output: result } });
    }
    if (toolCalls.length) send({ type: "response.create" });
  }

  return {
    sdp: answer,
    close: async () => {
      await call.fetch(`/realtime/calls/${encodeURIComponent(id)}/hangup`, { method: "POST", headers: auth });
    },
    done: new Promise((resolve) => ws.onclose = () => resolve()),
  };
}
