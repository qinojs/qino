import { openai, post } from "./openai.ts";

import type { EmbedInput } from "../mod.ts";
import type { Adapter } from "./run.ts";

/** NVIDIA's asymmetric embeddings use passage and query modes. */
export const nvidia: Adapter = {
  ...openai,
  embed: async (call, input: EmbedInput) => {
    if (!input.texts) return openai.embed(call, input);
    const data = await post(call, "/embeddings", {
      model: call.model, input: input.texts, input_type: input.purpose === "query" ? "query" : "passage",
    });
    call.usage(data.usage?.prompt_tokens);
    return data.data.map((item: { embedding: number[] }) => item.embedding);
  },
};
