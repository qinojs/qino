import { hee, getCtx, type App } from "../core/mod.ts";

export function healthChecks(app: App) {
  const ctx      = getCtx();
  const settings = app.settings;
  const domain   = ctx.req.url.hostname.replace(/^www\./, "");

  return { notice: {

    'default "mail from" is not in this domain': async () => {
      const value = String(await settings.mail.sender ?? "");
      if (value.endsWith("@" + domain)) return;
      return { info: "its: " + hee(value), solutions: { [`set it to: info@${domain}`]: { solve: async () => { await settings.mail.sender("info@" + domain); } } } };
    },

    'mail "reply-to" not from this domain': async () => {
      const value = String(await settings.mail.reply_to ?? "");
      if (value.endsWith("@" + domain)) return;
      return { info: "its: " + hee(value), solutions: { [`set it to: info@${domain}`]: { solve: async () => { await settings.mail.reply_to("info@" + domain); } } } };
    },

    "no mail recipient on debug mode": async () => {
      if (await settings.mail.debug_to) return;
      const usr = ctx.user;
      if (!usr || !await usr.get("superuser")) return;
      const email = String(await usr.get("email") ?? "");
      return { solutions: { [`set it to: ${hee(email)}`]: { solve: async () => { await settings.mail.debug_to(email); } } } };
    },

  } };
}
