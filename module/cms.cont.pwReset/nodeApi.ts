import type { Node } from "@qino/qino/cms";
import { ApiError, unixTime } from "@qino/qino";
import { mail } from "@qino/qino/mail";
import { issue, redeem } from "@qino/qino/ticket";

export const PURPOSE = "auth.pwReset";
export const TICKET_PARAM = "cmsContPwReset_t";
export const TTL = 60 * 60;

/**
 * Public by nature — whoever forgot their password has no session. Requesting always answers the
 * same, so this cannot be used to find out which addresses have an account.
 */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  if (vars.request) {
    const email = String(vars.request).trim().toLowerCase();
    const usrId = await app.db.one`SELECT id FROM usr WHERE email = ${email} AND active = ${true}`;
    if (usrId) await sendLink(node, Number(usrId), email);
    return { ok: true, message: await app.t`If that address has an account, a link is on its way.` };
  }
  if (vars.reset) {
    const { handle, pw } = vars.reset as { handle: string; pw: string };
    if (String(pw ?? "").length < 8) return { ok: false, message: await app.t`The password is too short.` };
    // only a spent or unknown handle is answered softly — anything else is a real fault
    const failed = await redeem(app, String(handle), { pw })
      .then(() => false, (e) => e instanceof ApiError ? true : Promise.reject(e));
    if (failed) return { ok: false, message: await app.t`This link is no longer valid. Please request a new one.` };
    return { ok: true, message: await app.t`Your password is set. You can sign in now.` };
  }
  return null;
}

async function sendLink(node: Node, usrId: number, email: string) {
  const app = node.app;
  const handle = await issue(app, PURPOSE, { usrId });
  // the node's own page, not the api endpoint this call arrived at
  const url = new URL(await node.url(), await mail(app).baseURL());
  url.searchParams.set(TICKET_PARAM, handle);
  const until = new Date((unixTime() + TTL) * 1000).toISOString().slice(0, 16).replace("T", " ");
  const msg = await mail(app).create({
    subject: await app.t`Set a new password`,
    text: await app.t`Open this link to set a new password: ${url.href}

The link is valid until ${until} UTC. If you did not ask for it, ignore this mail.`,
  });
  msg.addTo(email);
  // not awaited: the answer must take the same time whether or not the address has an account
  msg.send().catch((e) => console.error("[pwReset]", e));
}
