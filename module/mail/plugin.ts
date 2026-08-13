import type { App } from "@qino/qino";
import { msgOf, titleOf, type Channel, type Msg, type To } from "@qino/qino/messaging";
import dbSchema from "./dbschema.json" with { type: "json" };
import { mail } from "./mod.ts";
import { MailManager, mailInstances } from "./lib/MailManager.ts";
import { handleTrack } from "./lib/tracking.ts";
import { settingsSchema } from "./lib/transport.ts";

export { dbSchema, settingsSchema };
export { healthChecks } from "./healthChecks.ts";

// Reachable as a messaging channel; the declaration is inert until messaging looks for it.
export const messagingChannel: Channel = {
  name: "email",
  label: "Email",
  color: "--orange",
  reach: async (app: App, usrId: number) =>
    await app.db.one`SELECT email FROM usr WHERE id = ${usrId}` ? 1 : 0,
  // a mail needs a subject; an absent title is the first line of the text
  send: async (app: App, to: To, message: string | Msg) => {
    if (to.usr == null) throw new Error("mail as a channel sends to { usr } — use mail(app) for anything else");
    const usr = await app.db.row`SELECT id, email, firstname, lastname FROM usr WHERE id = ${to.usr}`;
    if (!usr?.email) return 0;
    const msg = msgOf(message);
    const mailMsg = await mail(app).create({ subject: titleOf(msg), text: msg.text, template: undefined });
    await mailMsg.addUsr(usr);
    await mailMsg.save();
    return await mailMsg.send() ? 1 : 0;
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  mailInstances.set(app, new MailManager(app));
  app.on("route", ({ ctx }) => handleTrack(ctx), { signal });
}
