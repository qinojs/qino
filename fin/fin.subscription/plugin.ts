import { bill } from "./mod.ts";

import type { App } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };
export { api } from "./api.ts";

export const settingsSchema = {
  properties: {
    lead: { type: "integer", default: 30, description: "Days before a period begins that it is billed" },
    issue: {
      type: "boolean",
      default: false,
      description: "Issue the invoices at once; otherwise they wait as drafts to be looked at",
    },
    send: {
      type: "boolean",
      default: false,
      description: "Issue them and mail them to the customer with their PDF (needs messaging.email)",
    },
  },
};

export const cron = {
  bill: { every: 86400, timeout: 600, run: (app: App) => bill(app) },
} satisfies Jobs;
