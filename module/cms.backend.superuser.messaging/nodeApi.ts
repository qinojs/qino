import type { Node } from "../cms/mod.ts";
import { mail } from "../mail/mod.ts";
import { send as sendSms } from "../messaging.sms/mod.ts";
import { send as sendTelegram } from "../messaging.telegram/mod.ts";
import { push } from "../messaging.web_push/mod.ts";

/** Node access is the permission — replies are limited to an existing user. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (!vars.reply && !vars.telegramReply) return null;
  const app = node.app;
  try {
    const legacy = vars.telegramReply;
    const { usr, channel: inputChannel, text: input } = (vars.reply ?? legacy) as Record<string, unknown>;
    const usrId = Number(usr);
    const channel = legacy ? "telegram" : String(inputChannel ?? "");
    const text = String(input ?? "").trim();
    const user = Number.isSafeInteger(usrId) && usrId > 0
      ? await app.db.row`SELECT id, email, firstname, lastname FROM usr WHERE id = ${usrId}`
      : undefined;
    if (!user) {
      return { ok: false, message: await app.t`User not found.` };
    }
    if (!text) return { ok: false, message: await app.t`A text is required.` };
    if (text.length > 4096) return { ok: false, message: await app.t`The message is too long.` };
    if (channel === "telegram") {
      if (!app.modules.get("messaging.telegram")) return { ok: false, message: await app.t`Telegram is not enabled.` };
      const sent = await sendTelegram(app, { usr: usrId }, { text });
      return sent
        ? { ok: true, message: await app.t`Delivered to ${sent} chats.` }
        : { ok: false, message: await app.t`No Telegram chat reached.` };
    }
    if (channel === "sms") {
      if (!app.modules.get("messaging.sms")) return { ok: false, message: await app.t`SMS is not enabled.` };
      const sent = await sendSms(app, { usr: usrId }, text);
      return sent
        ? { ok: true, message: await app.t`Delivered by SMS.` }
        : { ok: false, message: await app.t`No phone reached.` };
    }
    if (channel === "web_push") {
      if (!app.modules.get("messaging.web_push")) return { ok: false, message: await app.t`Web Push is not enabled.` };
      const sent = await push(app, { usr: usrId }, { title: await app.t`Message`, body: text });
      return sent
        ? { ok: true, message: await app.t`Delivered to ${sent} browsers.` }
        : { ok: false, message: await app.t`No browser reached.` };
    }
    if (channel === "email") {
      if (!app.modules.get("mail") || !user.email) return { ok: false, message: await app.t`Email is not available.` };
      const msg = await mail(app).create({ subject: await app.t`Message`, text, template: undefined });
      msg.addTo(String(user.email), [user.firstname, user.lastname].filter(Boolean).join(" "));
      await msg.save();
      await app.db.table("mail_recipient").update({ mail_id: msg.id, email: user.email, usr_id: usrId });
      return await msg.send()
        ? { ok: true, message: await app.t`Email sent.` }
        : { ok: false, message: await app.t`Email could not be sent.` };
    }
    return { ok: false, message: await app.t`Channel is not available.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
