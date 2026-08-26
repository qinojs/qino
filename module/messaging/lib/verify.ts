import { ApiError, beforeProof, contactKey, keyed, proofFailed, proofPassed, safeEqual, unixTime } from "@qino/qino";

import type { App, Row } from "@qino/qino";

// Proof that a contact belongs to a user, for the address kinds a stranger could claim — a phone
// number, a mail address. Telegram and Web Push need none: a chat id comes only from a real update,
// an endpoint only from the browser itself.
//
// Keyed by the kind, like the contact it becomes: proving a number proves the number, whether the
// code arrived by sms or by whatsapp.
//
// Pending claims live here and nowhere else, so core's `usr_contact` holds verified contacts
// only and `WHERE verified IS NOT NULL` stops being a rule one can forget.
//
// Not a [ticket](../../ticket/): that one is a capability — whoever knows the handle may act. Six
// digits are short enough to guess, so they only work together with "who is asking" — and with how
// often that one has tried, which core counts per account for every kind of proof at once. Counting
// it here instead would restart at zero with every resend, and would not see the guesses the same
// user is spending on their password next door.

const CODE_TTL = 10 * 60;
const RESEND_AFTER = 60;

/**
 * Start or resend a claim on `address`; resolves with the code to deliver.
 *
 * Anyone may claim any address — a claim says nothing until it is redeemed, and refusing a second
 * one would let a stranger lock the owner out of their own verification. What is protected is the
 * address itself: it receives at most one code per `RESEND_AFTER`, no matter who asks.
 */
export async function requestCode(app: App, type: string, usrId: number, input: string): Promise<string> {
  const address = contactKey(type, input); // a claim is keyed like the contact it becomes
  const now = unixTime();
  const table = app.db.table("usr_contact_verification");
  await app.db.exec`DELETE FROM usr_contact_verification WHERE expires < ${now}`; // no cron needed for this
  const recent = await app.db.one`SELECT MAX(sent) FROM usr_contact_verification
    WHERE type = ${type} AND address = ${address}`;
  if (Number(recent) > now - RESEND_AFTER) throw new ApiError(429, "Wait before requesting another verification code");
  const open = await claim(app, type, usrId, address);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  await table.ensure({
    type,
    address,
    usr_id: usrId,
    hash: await codeHash(app, type, address, code),
    expires: now + CODE_TTL,
    sent: now,
    created: Number(open?.created) || now,
  });
  return code;
}

/** Redeem a claim. Throws unless the code proves the contact is the user's; a right one spends it. */
export async function redeemCode(app: App, type: string, usrId: number, input: string, code: string): Promise<void> {
  const address = contactKey(type, input);
  const open = await claim(app, type, usrId, address);
  if (!open) throw new ApiError(404, "Nothing to verify");
  await beforeProof(app, usrId);
  const drop = () => app.db.exec`DELETE FROM usr_contact_verification
    WHERE type = ${type} AND address = ${address} AND usr_id = ${usrId}`;
  if (Number(open.expires) < unixTime()) {
    await drop();
    throw new ApiError(410, "Verification code expired");
  }
  if (/^\d{6}$/.test(code) && safeEqual(await codeHash(app, type, address, code), String(open.hash))) {
    await proofPassed(app, usrId);
    return void await drop();
  }
  await proofFailed(app, usrId);
  throw new ApiError(422, "Verification code is invalid");
}

/** Claims of one user on one kind of address — what a "pending" list shows. */
export function pendingContacts(app: App, type: string, usrId?: number): Promise<Row[]> {
  const now = unixTime();
  return usrId == null
    ? app.db.query`SELECT v.type, v.address, v.usr_id, v.expires, v.sent, v.created, u.username
        FROM usr_contact_verification v LEFT JOIN usr u ON u.id = v.usr_id
        WHERE v.type = ${type} AND v.expires >= ${now} ORDER BY v.created DESC`
    : app.db.query`SELECT type, address, usr_id, expires, sent, created FROM usr_contact_verification
        WHERE type = ${type} AND usr_id = ${usrId} AND expires >= ${now} ORDER BY created`;
}

/** Drop one user's claim without redeeming it — an admin approving it, or the user giving up. */
export async function dropClaim(app: App, type: string, usrId: number, input: string): Promise<Row | undefined> {
  const address = contactKey(type, input);
  const open = await claim(app, type, usrId, address);
  if (open) {
    await app.db.exec`DELETE FROM usr_contact_verification
      WHERE type = ${type} AND address = ${address} AND usr_id = ${usrId}`;
  }
  return open;
}

function claim(app: App, type: string, usrId: number, address: string): Promise<Row | undefined> {
  return app.db.row`SELECT * FROM usr_contact_verification
    WHERE type = ${type} AND address = ${address} AND usr_id = ${usrId}`;
}

function codeHash(app: App, type: string, address: string, code: string): Promise<string> {
  return keyed(app, [`messaging.${type}`, address, code]);
}
