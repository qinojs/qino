import { sync } from "./mod.ts";

import type { App } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";

export const settingsSchema = {
  properties: {
    auto: { type: "boolean", default: false, description: "Reindex changed CMS texts and files each hour." },
    chunkChars: { type: "integer", minimum: 100, default: 4000, description: "Maximum characters per indexed text part." },
  },
};

export const cron = {
  sync: { every: "hour", run: async (app: App) => { if (await app.settings["cms.embed"].auto) await sync(app); } },
} satisfies Jobs;
