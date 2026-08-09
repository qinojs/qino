import type { Node } from "../cms/mod.ts";
import { getCtx } from "../core/mod.ts";
import { mail } from "../mail/mod.ts";
import { issue, redeem } from "../ticket/mod.ts";

export const PURPOSE = "auth.pwReset";
export const TICKET_PARAM = "cmsContPwReset_t";

/**
 * Public by nature — whoever forgot their password has no session. Requesting always answers the
 * same, so this cannot be used to find out which addresses have an account.
 */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  if (vars.request) {
    const email = String(vars.request).trim().toLowerCase();
    const usr = await app.db.row`SELECT id, firstname, lastname FROM usr WHERE email = ${email} AND active = ${true}`;
    if (usr) await sendLink(node, String(usr.id), email);
    return { ok: true, message: await app.t`If that address has an account, a link is on its way.` };
  }
  if (vars.reset) {
    const { handle, pw } = vars.reset as { handle: string; pw: string };
    if (String(pw ?? "").length < 8) return { ok: false, message: await app.t`The password is too short.` };
    try {
      await redeem(app, String(handle), { purpose: PURPOSE, input: { pw } });
    } catch {
      return { ok: false, message: await app.t`This link is no longer valid. Please request a new one.` };
    }
    return { ok: true, message: await app.t`Your password is set. You can sign in now.` };
  }
  return null;
}

async function sendLink(node: Node, usrId: string, email: string) {
  const app = node.app;
  const handle = await issue(app, PURPOSE, { usrId });
  const url = getCtx().req.url.toURL();
  url.searchParams.set(TICKET_PARAM, handle);
  const msg = await mail(app).create({
    subject: await app.t`Set a new password`,
    text: await app.t`Open this link to set a new password: ${url.href}`,
  });
  msg.addTo(email);
  await msg.send();
}
