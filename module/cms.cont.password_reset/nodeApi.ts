import { ApiError, contactOwner, getCtx, unixTime } from "@qino/qino";
import { send } from "@qino/qino/messaging.email";
import { issue, redeem } from "@qino/qino/ticket";

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export const PURPOSE = "auth.pwReset";
export const TICKET_PARAM = "cmsContPwReset_t";
export const TTL = 60 * 60;
const PER_HOUR = 3; // links an account gets at most: enough for a lost mail, too few to flood an inbox

/**
 * Public (no session when the password is forgotten). The answer is always the same, so it reveals
 * no accounts.
 */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  const t = app.t;
  if (vars.request) {
    const email = String(vars.request).trim().toLowerCase();
    // the address has to be a verified contact: a login handle that looks like one proves nothing
    const usrId = await contactOwner(app.db, "email", email);
    // anonymous and it mails: every request counts a little, one past the limit more (sendLink)
    suspicious(app, 1, "password reset requested");
    // not awaited: the answer must take the same time whether or not the address has an account
    if (usrId) sendLink(node, usrId, email).catch((e) => console.error("[pwReset]", e));
    const message = await t`If that address has an account, a link is on its way. Please also check your spam folder.`;
    return { ok: true, message };
  }
  if (vars.reset) {
    const { handle, pw } = vars.reset as { handle: string; pw: string };
    if (String(pw ?? "").length < 8) return { ok: false, message: await t`The password is too short.` };
    // only a spent or unknown handle is answered softly — anything else is a real fault
    const ok = await redeem(app, String(handle), PURPOSE, { pw })
      .then(() => true, (e) => e instanceof ApiError ? false : Promise.reject(e));
    const message = ok
      ? await t`Your password is set. You can sign in now.`
      : await t`This link is no longer valid. Please request a new one.`;
    return { ok, message };
  }
  return null;
}

/** Not awaited: the security module adds it up per IP. */
const suspicious = (app: App, weight: number, reason: string) =>
  app.fire("suspicious", { ctx: getCtx(), weight, reason }).catch(() => {});

/* todo: ticket will be shortened by shorturl */
async function sendLink(node: Node, usrId: number, email: string) {
  const app = node.app;
  if (!await app.db.one`SELECT id FROM usr WHERE id = ${usrId} AND active = ${true}`) return;
  const sent = await app.db.one`SELECT COUNT(*) FROM ticket WHERE purpose = ${PURPOSE}
    AND data = ${JSON.stringify({ usrId })} AND created > ${unixTime() - 3600}`;
  if (Number(sent) >= PER_HOUR) return suspicious(app, 2, "password reset past the limit");
  const handle = await issue(app, PURPOSE, { usrId });
  // the node's own page, not the api endpoint this call arrived at
  const url = new URL(await node.url(), await app.url());
  url.searchParams.set(TICKET_PARAM, handle);
  const until = new Date((unixTime() + TTL) * 1000).toISOString().slice(0, 16).replace("T", " ");
  const text = await app.t`Open this link to set a new password: ${url.href}

The link is valid until ${until} UTC. If you did not ask for it, ignore this mail.`;
  await send(app, { email }, { title: await app.t`Set a new password`, text });
}
