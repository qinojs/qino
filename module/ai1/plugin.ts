import { openai } from "./lib/openai.ts";
import { deepl, google } from "./lib/translate.ts";

export { api } from "./api.ts";
export { default as dbSchema } from "./dbschema.json" with { type: "json" };

/** How capabilities fall back to others. Other modules add theirs the same way. */
export { ai1Tasks } from "./lib/tasks.ts";

/** Provider types by `ai1_provider.type`. Other modules add theirs the same way. */
export const ai1Adapters = { openai, deepl, google };
