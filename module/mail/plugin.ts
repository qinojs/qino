import type { App } from "../core/mod.ts";
import type { Channel } from "../messaging/mod.ts";
import dbSchema from "./dbschema.json" with { type: "json" };
import { mail } from "./mod.ts";
import { MailManager, mailInstances } from "./lib/MailManager.ts";
import { handleTrack } from "./lib/tracking.ts";
import { settingsSchema } from "./lib/transport.ts";

export const name = "mail";
export const description = "Creates, delivers, tracks, and stores email messages.";
export const needs = ["core"];
export { dbSchema, settingsSchema };
export { healthChecks } from "./healthChecks.ts";

// Reachable as a messaging channel; the declaration is inert until messaging looks for it.
export const messagingChannel: Channel = {
  name: "email",
  label: "Email",
  color: "--orange",
  reach: async (app: App, usrId: number) =>
    await app.db.one`SELECT email FROM usr WHERE id = ${usrId}` ? 1 : 0,
  send: async (app: App, usrId: number, text: string) => {
    const usr = await app.db.row`SELECT id, email, firstname, lastname FROM usr WHERE id = ${usrId}`;
    if (!usr?.email) return 0;
    const msg = await mail(app).create({ subject: await app.t`Message`, text, template: undefined });
    await msg.addUsr(usr);
    await msg.save();
    return await msg.send() ? 1 : 0;
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  mailInstances.set(app, new MailManager(app));
  app.on("route", ({ ctx }) => handleTrack(ctx), { signal });
}
