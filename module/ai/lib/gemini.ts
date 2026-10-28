// deno-lint-ignore-file no-explicit-any
import { AiError } from "./request.ts";
import { openai } from "./openai.ts";

import type { MusicInput } from "../mod.ts";
import type { Adapter } from "./request.ts";

/** Gemini: OpenAI-compatible (endpoint …/v1beta/openai), music (Lyria) through its own Interactions API. */
export const gemini: Adapter = {
  ...openai,
  music: async (call, { prompt, lyrics, seconds }: MusicInput) => {
    // lyrics and length go in the prompt: Lyria has no fields for them
    const input = [prompt, seconds && `Length: about ${seconds} seconds.`, lyrics && `Lyrics:\n${lyrics}`].filter(Boolean).join("\n\n");
    const res = await call.fetch("/../interactions", { // beside the OpenAI-compatible endpoint
      method: "POST",
      headers: { "x-goog-api-key": call.key, "content-type": "application/json" },
      body: JSON.stringify({ model: call.model.replace(/^models\//, ""), input, response_format: { type: "audio" } }),
    });
    const data = await res.json();
    const audio = data.steps?.filter((s: any) => s.type === "model_output").flatMap((s: any) => s.content ?? []).find((c: any) => c.type === "audio");
    if (!audio?.data) throw new AiError("No audio in the answer", 502);
    call.usage(input.length, 1);
    return `data:${audio.mime_type ?? "audio/mpeg"};base64,${audio.data}`;
  },
};
