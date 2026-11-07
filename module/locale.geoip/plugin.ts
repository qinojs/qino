import { geoip, NAMES } from "./mod.ts";

import type { App } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";

export const settingsSchema = {
  properties: {
    source: { type: "string", enum: NAMES, default: "dbip", description: "Where the ranges come from: dbip (DB-IP Lite, CC BY 4.0) or rir (registries, public)." },
  },
};

/** DB-IP publishes monthly; a table older than four weeks is fetched anew. */
const MAX_AGE = 28 * 86400_000;

export const cron = {
  update: {
    every: "week",
    at: { hour: 3 },
    jitter: 3 * 60 * 60,
    timeout: 10 * 60,
    run: async (app: App) => {
      if (Date.now() - (await geoip.fetched(app) ?? 0) < MAX_AGE) return;
      await geoip.update(app);
    },
  },
} satisfies Jobs;
