import { jina } from "./lib/jina.ts";
import { count } from "./lib/limit.ts";
import { nvidia } from "./lib/nvidia.ts";
import { openai, openrouter } from "./lib/openai.ts";
import { deepl, google } from "./lib/translate.ts";

import type { App } from "@qino/qino";

export { api } from "./api.ts";
export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const settingsSchema = {
  properties: {
    dailyLimit: { type: "integer", minimum: 0, default: 100000, description: "Units (tokens, characters, seconds, images) a user's requests may use per day before the browser API refuses; 0 = no limit" },
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("ai1:call", (e) => count(app, e), { signal });
}

/** How capabilities are served and fall back to others. Other modules add theirs the same way. */
export { ai1Capabilities } from "./lib/capabilities.ts";

/** Provider types by `ai1_provider.type`. Other modules add theirs the same way. */
export const ai1Adapters = { openai, openrouter, jina, nvidia, deepl, google };
