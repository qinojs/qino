import { ApiError, contactOwner, unixTime } from "@qino/qino";
import { send } from "@qino/qino/messaging.email";
import { issue, redeem } from "@qino/qino/ticket";

import type { Node } from "@qino/qino/cms";

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
    // the address has to be a verified contact: a login handle that looks like one proves nothing
    const usrId = await contactOwner(app.db, "email", email);
    const active = usrId && await app.db.one`SELECT id FROM usr WHERE id = ${usrId} AND active = ${true}`;
    if (active) await sendLink(node, usrId, email);
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

/* todo: ticket will be shortet by shorturl */
async function sendLink(node: Node, usrId: number, email: string) {
  const app = node.app;
  const handle = await issue(app, PURPOSE, { usrId });
  // the node's own page, not the api endpoint this call arrived at
  const url = new URL(await node.url(), await app.url());
  url.searchParams.set(TICKET_PARAM, handle);
  const until = new Date((unixTime() + TTL) * 1000).toISOString().slice(0, 16).replace("T", " ");
  const text = await app.t`Open this link to set a new password: ${url.href}

The link is valid until ${until} UTC. If you did not ask for it, ignore this mail.`;
  // not awaited: the answer must take the same time whether or not the address has an account
  send(app, { email }, { title: String(await app.t`Set a new password`), text: String(text) })
    .catch((e) => console.error("[pwReset]", e));
}
