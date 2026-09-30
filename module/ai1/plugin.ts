import { App, s } from "@qino/qino";

import { jina } from "./lib/jina.ts";
import { nvidia } from "./lib/nvidia.ts";
import { openai, openrouter } from "./lib/openai.ts";
import { deepl, google } from "./lib/translate.ts";

import type { EventDecls } from "@qino/qino";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

Object.assign(App.events, {
  "ai1:call": {
    description: "A model was called, successfully or not.",
    data: s.object({
      capability: s.string().describe("text, structured, embed, translate, …"),
      id: s.number().describe("The model's id."),
      model: s.string(),
      provider: s.string(),
      ms: s.number().describe("How long it took."),
      input: s.number().describe("Input units (tokens, characters)."),
      output: s.number().describe("Output units."),
      error: s.optional(s.string().describe("Why it failed.")),
    }),
  },
} satisfies EventDecls);

/** How capabilities are served and fall back to others. Other modules add theirs the same way. */
export { ai1Capabilities } from "./lib/capabilities.ts";

/** Provider types by `ai1_provider.type`. Other modules add theirs the same way. */
export const ai1Adapters = { openai, openrouter, jina, nvidia, deepl, google };
