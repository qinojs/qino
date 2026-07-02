import type { App } from "../core/mod.ts";
import dbSchema from "./dbschema.json" with { type: "json" };
import { MailManager } from "./lib/MailManager.ts";
import { handleTrack } from "./lib/tracking.ts";
import { settingsSchema } from "./lib/transport.ts";
import type {} from "./mod.ts";

export const name = "mail";
export const needs = ["core"];
export { dbSchema, MailManager, settingsSchema };
export { MailMessage } from "./lib/MailMessage.ts";
export { healthChecks } from "./healthChecks.ts";

export function init(app: App): void {
  app.mail = new MailManager(app);
  app.on("action", ({ ctx }) => handleTrack(ctx));
}
