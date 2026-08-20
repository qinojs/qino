import { MailManager, mailInstances } from "./lib/MailManager.ts";
import { handleTrack } from "./lib/tracking.ts";

import type { App } from "@qino/qino";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };
export { settingsSchema } from "./lib/transport.ts";
export { healthChecks } from "./healthChecks.ts";

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  mailInstances.set(app, new MailManager(app));
  app.on("route", ({ ctx }) => handleTrack(ctx), { signal });
}
