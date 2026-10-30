import { remindDue } from "./mod.ts";

import type { App } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const settingsSchema = {
  properties: {
    days: {
      type: "string",
      default: "10, 20, 30",
      description: "Days after the due date each level goes out: the payment reminder, then the reminders",
    },
    fees: {
      type: "string",
      default: "",
      description: "Fee per level, with tax, in the invoice's currency: e.g. 0, 20, 30. Only where agreed (terms)",
    },
    interest: {
      type: "number",
      description: "Default interest in percent a year, charged from the due date; empty: none",
    },
    term: { type: "integer", default: 10, description: "Days to pay a reminder" },
    issue: {
      type: "boolean",
      default: true,
      description: "Issue the reminders at once; otherwise they wait as drafts to be looked at",
    },
    send: {
      type: "boolean",
      default: true,
      description: "Mail issued reminders to the customer with their PDF (needs messaging.email)",
    },
  },
};

export const cron = {
  remind: { every: 86400, timeout: 600, run: (app: App, { signal }) => remindDue(app, { signal }) },
} satisfies Jobs;
