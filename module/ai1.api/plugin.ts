import { count } from "./lib/limit.ts";

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
