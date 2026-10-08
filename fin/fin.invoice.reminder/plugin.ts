import { remindDue } from "./mod.ts";

import type { App } from "@qino/qino";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const settingsSchema = {
  properties: {
    days: {
      type: "string",
      default: "10, 20, 30",
      description: "Days after the due date each reminder goes out: the payment reminder, then the reminders",
    },
  },
};

export const cron = {
  remind: { every: 86400, timeout: 600, run: (app: App) => remindDue(app) },
};
