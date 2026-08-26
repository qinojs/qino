import { outbox, sync } from "./mod.ts";

import type { App } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const cron = {
  outbox: { every: 60, timeout: 120, run: (app: App) => outbox(app) },
  sync: { every: 300, timeout: 120, run: (app: App) => sync(app) },
} satisfies Jobs;
