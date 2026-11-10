import { sync } from "./mod.ts";

import type { Jobs } from "@qino/qino/cron";

export const settingsSchema = {
  properties: {
    config: { type: "string", description: "Absolute path to this tenant's private EBICS connection file" },
  },
};

export const cron = {
  download: {
    every: "hour",
    timeout: 10 * 60,
    async run(app) {
      const path = String(await app.settings["fin.bank.ebics"].config ?? "");
      if (path) await sync(app, path);
    },
  },
} satisfies Jobs;
