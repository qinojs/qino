// Public API of ai. The qino plugin lives in ./plugin.ts.

import type { App } from "../core/mod.ts";
import { aiInstances, type AiApi } from "./lib/AiApi.ts";

/** The app's ai instance. Throws when ai is not loaded. */
export function ai(app: App): AiApi {
  const api = aiInstances.get(app);
  if (!api) throw new Error('module "ai" is not loaded');
  return api;
}

/** Undefined when ai is not loaded — for optional dependencies. */
ai.get = (app: App): AiApi | undefined => aiInstances.get(app);

export { AiApi } from "./lib/AiApi.ts";
export { providerCatalog } from "./catalog.ts";
export { KINDS } from "./types.ts";
export type { Bot, ClientContext } from "./types.ts";
