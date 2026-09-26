import { openai, post } from "./openai.ts";

import type { EmbedInput } from "../mod.ts";
import type { Adapter } from "./run.ts";

/** Jina's multimodal embedding request, with OpenAI compatibility for its other models. */
export const jina: Adapter = {
  ...openai,
  embed: async (call, input: EmbedInput) => {
    if (!call.model.startsWith("jina-embeddings-v5-omni-")) return openai.embed(call, input);
    const data = await post(call, "/embeddings", {
      model: call.model,
      task: input.purpose === "query" ? "retrieval.query" : "retrieval.passage",
      input: input.texts?.map((text) => ({ text })) ?? input.images!.map((image) => ({ image })),
    });
    call.usage(data.usage?.prompt_tokens);
    return data.data.map((item: { embedding: number[] }) => item.embedding);
  },
};
