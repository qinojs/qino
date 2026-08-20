// Public API of messaging.sms. The qino plugin lives in ./plugin.ts.
import { addContact, ApiError, contactError, contactKey, contactOwner, contacts, errMsg, removeContact, setMainContact, sql, typeContacts, unixTime } from "@qino/qino";
import { dropClaim, msgOf, pendingContacts, record, redeemCode, requestCode, textOf } from "@qino/qino/messaging";

import { deliver, setProvider } from "./lib/provider.ts";

import type { App, Row } from "@qino/qino";
import type { Msg } from "@qino/qino/messaging";
import type { SmsProvider } from "./lib/provider.ts";

export { setProvider, type SmsProvider };

/**
 * Deliver text to the phones of a group, user, one number, or everyone — `usr_contact` holds
 * verified numbers only, so a group or user selection needs no filtering.
 *
 * `{ phone }` is the number itself and reaches it whether or not anyone verified it; a number
 * that is somebody's is journaled as theirs. An SMS is text and nothing else: markup is flattened
 * and a `title` becomes the first line.
 */
export async function send(
  app: App,
  to: { grp?: number; usr?: number; all?: true; phone?: string },
  message: string | Msg,
): Promise<number> {
  const msg = msgOf(message);
  const body = textOf(msg);
  const text = msg.title ? `${msg.title}\n${body}` : body;
  const number = to.phone == null ? "" : phoneNumber(to.phone);
  const target = to.grp != null ? sql`c.usr_id IN (SELECT usr_id FROM usr_grp WHERE grp_id = ${to.grp})`
    : to.usr != null ? sql`c.usr_id = ${to.usr}`
    : number ? sql`c.address = ${number}`
    : to.all ? sql`${true}`
    : null;
  if (!target) throw new Error("send needs a recipient: { grp }, { usr }, { phone } or { all: true }");
  const time = unixTime();

  // one number per user: the preferred one, else the oldest
  const preferred = number ? sql`` : sql`AND c.address = (
    SELECT other.address FROM usr_contact other
    WHERE other.type = ${"phone"} AND other.usr_id = c.usr_id
    ORDER BY other.main DESC, other.created, other.address LIMIT 1)`;
  const rows = await app.db.query`
    SELECT c.usr_id, c.address, c.error FROM usr_contact c
    WHERE c.type = ${"phone"} AND ${target} ${preferred}`;
  // a number nobody verified is still a number — it goes out, without an owner
  if (number && !rows.length) rows.push({ usr_id: null, address: number, error: null });
  const deliveries = [];
  let sent = 0;
  for (const row of rows) {
    const address = String(row.address);
    const usrId = Number(row.usr_id) || undefined;
    try {
      await deliver(app, address, text);
      sent++;
      deliveries.push({ usrId, address, time: unixTime() });
      if (row.error) await contactError(app.db, "phone", address);
    } catch (e) {
      const message = errMsg(e);
      deliveries.push({ usrId, address, error: message, time: unixTime() });
      console.warn(`sms: ${address} rejected —`, message);
      if (usrId) await contactError(app.db, "phone", address, message);
    }
  }
  await record(app, { channel: "sms", direction: "out", grpId: to.grp, msg, data: { to }, time }, deliveries);
  return sent;
}

/** Claim a phone number and send its six-digit code. Nothing is stored on the user until it is verified. */
export async function addPhone(app: App, usrId: number, input: string): Promise<Row> {
  const number = phoneNumber(input);
  const owner = await contactOwner(app.db, "phone", number);
  if (owner && owner !== usrId) throw new ApiError(409, "Phone number is unavailable");
  if (owner) return (await app.db.row`SELECT * FROM usr_contact WHERE channel = ${"sms"} AND address = ${number}`)!;

  const time = unixTime();
  const code = await requestCode(app, "phone", usrId, number);
  const journal = (error?: string) =>
    record(app, { channel: "sms", direction: "out", data: { kind: "phone_verification" }, time }, [
      { usrId, address: number, error, time: unixTime() },
    ]);
  try {
    await deliver(app, number, await app.t`Your verification code is ${code}.`);
  } catch (e) {
    await journal(errMsg(e));
    throw e;
  }
  await journal();
  return { address: number };
}

/** Redeem the code and make the number the user's. */
export async function verifyPhone(app: App, usrId: number, input: string, code: string): Promise<Row> {
  const number = phoneNumber(input);
  await redeemCode(app, "phone", usrId, number, code);
  return addContact(app.db, usrId, "phone", number);
}

/** Take one user's claim as proven without its code; intended for trusted administration. */
export async function approvePhone(app: App, usrId: number, address: string): Promise<Row> {
  const claimed = await dropClaim(app, "phone", usrId, address);
  if (!claimed) throw new ApiError(404, "Nothing to verify");
  return addContact(app.db, Number(claimed.usr_id), "phone", String(claimed.address));
}

/** The user's verified numbers. */
export function userPhones(app: App, usrId: number): Promise<Row[]> {
  return contacts(app.db, usrId, "phone");
}

/** The numbers the user is in the middle of verifying. */
export function pendingPhones(app: App, usrId?: number): Promise<Row[]> {
  return pendingContacts(app, "phone", usrId);
}

/** Forget one number owned by the user. */
export function removePhone(app: App, usrId: number, number: string): Promise<void> {
  return removeContact(app.db, usrId, "phone", number);
}

/** Make a number the user's preferred SMS destination. */
export function setMainPhone(app: App, usrId: number, number: string): Promise<Row> {
  return setMainContact(app.db, usrId, "phone", number);
}

/** Every verified number with its owner. */
export function phones(app: App, limit = 500): Promise<Row[]> {
  return typeContacts(app.db, "phone", limit);
}

/** Normalize common formatting and require an international E.164 number. */
export const phoneNumber = (input: string): string => contactKey("phone", input);
