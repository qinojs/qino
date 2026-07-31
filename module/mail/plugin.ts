import type { App } from "../core/mod.ts";
import dbSchema from "./dbschema.json" with { type: "json" };
import { MailManager, mailInstances } from "./lib/MailManager.ts";
import { handleTrack } from "./lib/tracking.ts";
import { settingsSchema } from "./lib/transport.ts";

export const name = "mail";
export const description = "Creates, delivers, tracks, and stores email messages.";
export const needs = ["core"];
export { dbSchema, settingsSchema };
export { healthChecks } from "./healthChecks.ts";

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  mailInstances.set(app, new MailManager(app));
  app.on("route", ({ ctx }) => handleTrack(ctx), { signal });
}
