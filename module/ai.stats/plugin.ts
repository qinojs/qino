import { applySpeed, fade, record } from "./lib/stats.ts";

import type { App } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("ai:call", (e) => record(app, e), { signal });
}

// The measured speed goes into the choice of model hourly; the counts halve daily.
export const cron = {
  speed: { every: "hour", run: (app: App) => applySpeed(app) },
  fade: { every: "day", at: { hour: 4 }, jitter: 60 * 60, run: (app: App) => fade(app) },
} satisfies Jobs;
