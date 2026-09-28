import { jina } from "./lib/jina.ts";
import { nvidia } from "./lib/nvidia.ts";
import { openai, openrouter } from "./lib/openai.ts";
import { deepl, google } from "./lib/translate.ts";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

/** How capabilities are served and fall back to others. Other modules add theirs the same way. */
export { ai1Capabilities } from "./lib/capabilities.ts";

/** Provider types by `ai1_provider.type`. Other modules add theirs the same way. */
export const ai1Adapters = { openai, openrouter, jina, nvidia, deepl, google };
