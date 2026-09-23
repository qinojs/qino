import { ApiError, attempt, contactKey, keyed, proofPassed, safeEqual, unixTime } from "@qino/qino";

import type { App, Row } from "@qino/qino";

// Verifies that a phone number or mail address belongs to a user. Telegram and Web Push need none:
// chat ids come from real updates, endpoints from the browser.
//
// Keyed by address kind, like the resulting contact: a verified number is verified for sms and
// whatsapp alike.
//
// Pending claims live only here, so core's `usr_contact` holds verified contacts only.
//
// Not a [ticket](../../ticket/) (whoever has the handle may act): six digits can be guessed, so they
// need the user and core's per-account attempt count, which also covers password and other factors.
// A count here would restart with every resend.

const CODE_TTL = 10 * 60;
const RESEND_AFTER = 60;

/**
 * Start or resend a claim on `address`; resolves with the code to send.
 *
 * Anyone may claim any address — a claim means nothing until redeemed, and refusing a second one
 * would let a stranger block the owner. The address gets at most one code per `RESEND_AFTER`.
 */
export async function requestCode(app: App, type: string, usrId: number, input: string): Promise<string> {
  const address = contactKey(type, input); // normalized like the contact
  const now = unixTime();
  const table = app.db.table("usr_contact_verification");
  await app.db.exec`DELETE FROM usr_contact_verification WHERE expires < ${now}`; // cleanup, no cron needed
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

/** Redeem a claim. Throws if the code is wrong; a correct code uses up the claim. */
export async function redeemCode(app: App, type: string, usrId: number, input: string, code: string): Promise<void> {
  const address = contactKey(type, input);
  const open = await claim(app, type, usrId, address);
  if (!open) throw new ApiError(404, "Nothing to verify");
  const drop = () => app.db.exec`DELETE FROM usr_contact_verification
    WHERE type = ${type} AND address = ${address} AND usr_id = ${usrId}`;
  const right = await attempt(app, usrId, async () => {
    if (Number(open.expires) < unixTime()) {
      await drop();
      throw new ApiError(410, "Verification code expired");
    }
    return /^\d{6}$/.test(code) && safeEqual(await codeHash(app, type, address, code), String(open.hash));
  });
  if (!right) throw new ApiError(422, "Verification code is invalid");
  await proofPassed(app, usrId);
  await drop();
}

/** A user's open claims of one kind. */
export function pendingContacts(app: App, type: string, usrId?: number): Promise<Row[]> {
  const now = unixTime();
  return usrId == null
    ? app.db.query`SELECT v.type, v.address, v.usr_id, v.expires, v.sent, v.created, u.username
        FROM usr_contact_verification v LEFT JOIN usr u ON u.id = v.usr_id
        WHERE v.type = ${type} AND v.expires >= ${now} ORDER BY v.created DESC`
    : app.db.query`SELECT type, address, usr_id, expires, sent, created FROM usr_contact_verification
        WHERE type = ${type} AND usr_id = ${usrId} AND expires >= ${now} ORDER BY created`;
}

/** Remove a claim without code — an admin approving it, or the user cancelling. */
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
