import { App, s } from "@qino/qino";

import { poll } from "./lib/batch.ts";
import * as batches from "./lib/openai.batch.ts";

import { systemone, decisions } from "./lib/decide.ts";
import { fal } from "./lib/fal.ts";
import { gemini } from "./lib/gemini.ts";
import { jina } from "./lib/jina.ts";
import { nvidia } from "./lib/nvidia.ts";
import { openai, openrouter } from "./lib/openai.ts";
import { deepl, google } from "./lib/translate.ts";

import type { EventDecls } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

Object.assign(App.events, {
  "ai:call": {
    description: "A model was called, successfully or not.",
    data: s.object({
      capability: s.string().describe("text, structured, embed, translate, …"),
      id: s.number().describe("The model at its provider (ai_model_provider) that was called."),
      model: s.string(),
      provider: s.string(),
      ms: s.number().describe("How long it took."),
      input: s.number().describe("Input units (tokens, characters)."),
      output: s.number().describe("Output units."),
      error: s.optional(s.string().describe("Why it failed.")),
      batch: s.optional(s.boolean().describe("Answered in a batch: later, at its price, so not timed.")),
    }),
  },
  "ai:batched": {
    description: "A call of a batch was answered, or failed.",
    data: s.object({
      owner: s.string().describe("Who submitted the batch."),
      capability: s.string(),
      id: s.string().describe("The call's id, as submitted."),
      output: s.optional(s.any().describe("The answer, as the capability gives it.")),
      error: s.optional(s.string().describe("Why there is none.")),
    }),
  },
} satisfies EventDecls);

/** Deliver the answers of ended batches. */
export const cron = {
  batches: { every: 5 * 60, run: (app: App) => poll(app) },
} satisfies Jobs;

/** How capabilities are served and fall back to others. Other modules add theirs the same way. */
export { aiCapabilities } from "./lib/capabilities.ts";

/** Provider types by `ai_provider.type`. Other modules add theirs the same way. */
export const aiAdapters = { openai, openrouter, systemone, decisions, jina, nvidia, deepl, google, fal, gemini };

/** Batch APIs by provider type (see `batch`). Other modules add theirs the same way. */
export const aiBatches = { openai: batches.openai, openrouter: batches.openrouter };
