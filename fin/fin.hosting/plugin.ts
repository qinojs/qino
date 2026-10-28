import { adopt, sync } from "./mod.ts";

import type { App, Row } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };
export { api } from "./api.ts";

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  // a subscription named after a domain is for it: no domain to enter, no link to set by hand
  app.on("subscription:save", ({ subscription }: { subscription: Row }) =>
    adopt(app, subscription).then(() => {}, (e) => console.error("fin.hosting: subscription not linked", e)), { signal });
}

export const cron = {
  // what the registrars and hosts hold: new domains show up to be assigned, moved-away ones are no longer billed
  sync: { every: "day", at: { hour: 5 }, jitter: 60 * 60, run: (app: App) => sync(app).then(() => {}) },
} satisfies Jobs;
