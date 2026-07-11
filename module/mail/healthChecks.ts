import { hee, getCtx, type App } from "../core/mod.ts";
import type { HealthTypes } from "../cms.backend.system/healthRegistry.ts";

export function healthChecks(app: App): HealthTypes {
  const ctx      = getCtx();
  const settings = app.settings;
  const domain   = ctx.req.url.hostname.replace(/^www\./, "");

  const types: HealthTypes = { error: {}, warning: {}, notice: {}, cleanup: {}, repair: {} };
  const { notice } = types;

  notice['default "mail from" is not in this domain'] = async () => {
    const value = String(await settings.mail.sender ?? "");
    if (value.endsWith("@" + domain)) return;
    return { info: "its: " + hee(value), solutions: { [`set it to: info@${domain}`]: { solve: () => { settings.mail.sender("info@" + domain); } } } };
  };

  notice['mail "reply-to" not from this domain'] = async () => {
    const value = String(await settings.mail.reply_to ?? "");
    if (value.endsWith("@" + domain)) return;
    return { info: "its: " + hee(value), solutions: { [`set it to: info@${domain}`]: { solve: () => { settings.mail.reply_to("info@" + domain); } } } };
  };

  notice["no mail recipient on debug mode"] = async () => {
    if (await settings.mail.debug_to) return;
    const usr = ctx.user;
    if (!usr || !await usr.get("superuser")) return;
    const email = String(await usr.get("email") ?? "");
    return { solutions: { [`set it to: ${hee(email)}`]: { solve: () => { settings.mail.debug_to(email); } } } };
  };

  return types;
}
