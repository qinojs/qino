// Public API of ai. The qino plugin lives in ./plugin.ts.

import type { AiApi } from "./lib/AiApi.ts";

declare module "../core/lib/App.ts" {
  interface App { ai: AiApi; }
}

export { AiApi } from "./lib/AiApi.ts";
export { providerCatalog } from "./catalog.ts";
export { KINDS } from "./types.ts";
export type { Bot, Kind, ProviderModelRow, ProviderRow, Tool } from "./types.ts";
