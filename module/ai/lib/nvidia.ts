import { openai, vectors } from "./openai.ts";

import type { EmbedInput } from "../mod.ts";
import type { Adapter } from "./request.ts";

/** NVIDIA's asymmetric embeddings use passage and query modes. */
export const nvidia: Adapter = {
  ...openai,
  embed: async (call, input: EmbedInput) => {
    if (!input.texts) return openai.embed(call, input);
    return await vectors(call, {
      model: call.model, input: input.texts, input_type: input.purpose === "query" ? "query" : "passage",
    });
  },
};
