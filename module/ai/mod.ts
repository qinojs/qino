// Public API of ai. The qino plugin lives in ./plugin.ts.

import type { AiApi } from "./lib/AiApi.ts";

declare module "../core/lib/App.ts" {
  interface App { ai: AiApi; }
}

export { AiApi } from "./lib/AiApi.ts";
export { customProviderModels, parseProviderModels, providerModels } from "./lib/providerModels.ts";
export { providers } from "./lib/providers.ts";
export type { ProviderModel, ProviderStrength } from "./types.ts";
