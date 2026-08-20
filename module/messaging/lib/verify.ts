import { $item, ApiError, beforeProof, proofFailed, proofPassed, randB64, safeEqual, sha256b64url, unixTime } from "@qino/qino";

import type { App, Row } from "@qino/qino";

// Proof that a contact belongs to a user, for the channels whose address a stranger could claim —
// sms and mail. Telegram and Web Push need none: a chat id comes only from a real update, an
// endpoint only from the browser itself.
//
// Pending claims live here and nowhere else, so `usr_phone` holds verified contacts
// only and `WHERE verified IS NOT NULL` stops being a rule one can forget.
//
// Not a [ticket](../../ticket/): that one is a capability — whoever knows the handle may act. Six
// digits are short enough to guess, so they only work together with "who is asking" — and with how
// often that one has tried, which core counts per account for every kind of proof at once. Counting
// it here instead would restart at zero with every resend, and would not see the guesses the same
// user is spending on their password next door.

const CODE_TTL = 10 * 60;
const RESEND_AFTER = 60;

/** Start or resend a claim on `address`; resolves with the code to deliver. */
export async function requestCode(app: App, channel: string, usrId: number, address: string): Promise<string> {
  const now = unixTime();
  const table = app.db.table("usr_contact_verification");
  await app.db.exec`DELETE FROM usr_contact_verification WHERE expires < ${now}`; // no cron needed for this
  const open = await claim(app, channel, address);
  if (open) {
    if (Number(open.usr_id) !== usrId) throw new ApiError(409, "That contact is being verified by someone else");
    if (Number(open.sent) > now - RESEND_AFTER) throw new ApiError(429, "Wait before requesting another verification code");
  }
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  await table.ensure({
    channel,
    address,
    usr_id: usrId,
    hash: await codeHash(app, channel, address, code),
    expires: now + CODE_TTL,
    sent: now,
    created: Number(open?.created) || now,
  });
  return code;
}

/** Redeem a claim. Throws unless the code proves the contact is the user's; a right one spends it. */
export async function redeemCode(app: App, channel: string, usrId: number, address: string, code: string): Promise<void> {
  const open = await claim(app, channel, address);
  if (!open || Number(open.usr_id) !== usrId) throw new ApiError(404, "Nothing to verify");
  await beforeProof(app, usrId);
  const drop = () => app.db.exec`DELETE FROM usr_contact_verification WHERE channel = ${channel} AND address = ${address}`;
  if (Number(open.expires) < unixTime()) {
    await drop();
    throw new ApiError(410, "Verification code expired");
  }
  if (/^\d{6}$/.test(code) && safeEqual(await codeHash(app, channel, address, code), String(open.hash))) {
    await proofPassed(app, usrId);
    return void await drop();
  }
  await proofFailed(app, usrId);
  throw new ApiError(422, "Verification code is invalid");
}

/** Claims of one user on a channel — what a "pending" list shows. */
export function pendingContacts(app: App, channel: string, usrId?: number): Promise<Row[]> {
  const now = unixTime();
  return usrId == null
    ? app.db.query`SELECT v.channel, v.address, v.usr_id, v.expires, v.sent, v.created, u.email
        FROM usr_contact_verification v LEFT JOIN usr u ON u.id = v.usr_id
        WHERE v.channel = ${channel} AND v.expires >= ${now} ORDER BY v.created DESC`
    : app.db.query`SELECT channel, address, usr_id, expires, sent, created FROM usr_contact_verification
        WHERE channel = ${channel} AND usr_id = ${usrId} AND expires >= ${now} ORDER BY created`;
}

/** Drop a claim without redeeming it — an admin approving it, or the user giving up. */
export async function dropClaim(app: App, channel: string, address: string): Promise<Row | undefined> {
  const open = await claim(app, channel, address);
  if (open) await app.db.exec`DELETE FROM usr_contact_verification WHERE channel = ${channel} AND address = ${address}`;
  return open;
}

function claim(app: App, channel: string, address: string): Promise<Row | undefined> {
  return app.db.row`SELECT * FROM usr_contact_verification WHERE channel = ${channel} AND address = ${address}`;
}

function codeHash(app: App, channel: string, address: string, code: string): Promise<string> {
  return secret(app).then((key) => sha256b64url(`${key}\0${channel}\0${address}\0${code}`));
}

// One in-flight generation per app — two parallel first requests must not make two secrets,
// or the code hashed with the first one can never be redeemed.
const secrets = new WeakMap<App, Promise<string>>();

function secret(app: App): Promise<string> {
  return secrets.getOrInsertComputed(app, () => loadSecret(app).catch((e) => { secrets.delete(app); throw e; }));
}

async function loadSecret(app: App) {
  const stored = String(await app.settings["messaging"]._secret ?? "");
  if (stored) return stored;
  const fresh = randB64(32);
  // writing goes through the raw item — on the proxy, .set would read as a child key
  await app.settings[$item].sub(["messaging"]).item("_secret").set(fresh);
  return fresh;
}
