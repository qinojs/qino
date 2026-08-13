// Public API of messaging.sms. The qino plugin lives in ./plugin.ts.
import { ApiError, errMsg, sql, unixTime } from "@qino/qino";
import { dropClaim, msgOf, pendingContacts, record, redeemCode, requestCode } from "@qino/qino/messaging";

import { deliver, setProvider } from "./lib/provider.ts";

import type { App, Row } from "@qino/qino";
import type { Msg } from "@qino/qino/messaging";
import type { SmsProvider } from "./lib/provider.ts";

export { setProvider, type SmsProvider };

/**
 * Deliver text to the phones of a group, user, one phone, or everyone — `usr_phone` holds
 * verified numbers only, so there is nothing to filter out.
 * An SMS is text and nothing else, so a `title` becomes its first line.
 */
export async function send(
  app: App,
  to: { grp?: number; usr?: number; phone?: number; all?: true },
  message: string | Msg,
): Promise<number> {
  const msg = msgOf(message);
  const text = msg.title ? `${msg.title}\n${msg.text}` : msg.text;
  const target = to.grp != null ? sql`p.usr_id IN (SELECT usr_id FROM usr_grp WHERE grp_id = ${to.grp})`
    : to.usr != null ? sql`p.usr_id = ${to.usr}`
    : to.phone != null ? sql`p.id = ${to.phone}`
    : to.all ? sql`${true}`
    : null;
  if (!target) throw new Error("send needs a recipient: { grp }, { usr }, { phone } or { all: true }");
  const time = unixTime();

  // one number per user: the preferred one, else the oldest
  const preferred = to.phone != null ? sql`` : sql`AND p.id = (
    SELECT other.id FROM usr_phone other WHERE other.usr_id = p.usr_id
    ORDER BY other.main DESC, other.created, other.id LIMIT 1)`;
  const rows = await app.db.query`
    SELECT p.id, p.usr_id, p.number, p.error FROM usr_phone p
    WHERE ${target} ${preferred}`;
  const table = app.db.table("usr_phone");
  const deliveries = [];
  let sent = 0;
  for (const row of rows) {
    const address = String(row.number);
    try {
      await deliver(app, address, text);
      sent++;
      deliveries.push({ usrId: Number(row.usr_id), address, time: unixTime() });
      if (row.error) await table.update(row.id, { error: null });
    } catch (e) {
      const message = errMsg(e);
      deliveries.push({ usrId: Number(row.usr_id), address, error: message, time: unixTime() });
      console.warn(`sms: phone ${row.id} rejected —`, message);
      await table.update(row.id, { error: message.slice(0, 255) });
    }
  }
  await record(app, { channel: "sms", direction: "out", grpId: to.grp, data: { to, msg }, time }, deliveries);
  return sent;
}

/** Claim a phone number and send its six-digit code. Nothing is stored on the user until it is verified. */
export async function addPhone(app: App, usrId: number, input: string): Promise<Row> {
  const number = phoneNumber(input);
  const owner = await app.db.one`SELECT usr_id FROM usr_phone WHERE number = ${number}`;
  if (owner != null && Number(owner) !== usrId) throw new ApiError(409, "Phone number is unavailable");
  if (owner != null) return (await app.db.row`SELECT * FROM usr_phone WHERE number = ${number}`)!;

  const time = unixTime();
  const code = await requestCode(app, "sms", usrId, number);
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
  return { number };
}

/** Redeem the code and make the number the user's. */
export async function verifyPhone(app: App, usrId: number, input: string, code: string): Promise<Row> {
  const number = phoneNumber(input);
  await redeemCode(app, "sms", usrId, number, code);
  return addVerifiedPhone(app, usrId, number);
}

/** Take a claim as proven without its code; intended for trusted administration. */
export async function approvePhone(app: App, address: string): Promise<Row> {
  const claimed = await dropClaim(app, "sms", phoneNumber(address));
  if (!claimed) throw new ApiError(404, "Nothing to verify");
  return addVerifiedPhone(app, Number(claimed.usr_id), String(claimed.address));
}

/** The number becomes the user's; the first one is their main. */
async function addVerifiedPhone(app: App, usrId: number, number: string): Promise<Row> {
  const table = app.db.table("usr_phone");
  await app.db.transaction(async () => {
    const known = await app.db.one`SELECT id FROM usr_phone WHERE number = ${number}`;
    if (known) return;
    const main = !await app.db.one`SELECT id FROM usr_phone WHERE usr_id = ${usrId} AND main = ${true}`;
    await table.insert({ usr_id: usrId, number, created: unixTime(), main });
  });
  return (await app.db.row`SELECT * FROM usr_phone WHERE number = ${number}`)!;
}

/** The user's verified numbers. */
export function userPhones(app: App, usrId: number): Promise<Row[]> {
  return app.db.query`SELECT id, number, created, main FROM usr_phone WHERE usr_id = ${usrId} ORDER BY created`;
}

/** The numbers the user is in the middle of verifying. */
export function pendingPhones(app: App, usrId?: number): Promise<Row[]> {
  return pendingContacts(app, "sms", usrId);
}

/** Forget one phone owned by the user. */
export async function removePhone(app: App, usrId: number, id: number): Promise<void> {
  await app.db.transaction(async () => {
    const row = await app.db.row`SELECT main FROM usr_phone WHERE id = ${id} AND usr_id = ${usrId}`;
    if (!row) return;
    await app.db.exec`DELETE FROM usr_phone WHERE id = ${id} AND usr_id = ${usrId}`;
    if (row.main) {
      const next = await app.db.one`SELECT id FROM usr_phone WHERE usr_id = ${usrId} ORDER BY created LIMIT 1`;
      if (next) await app.db.table("usr_phone").update(next, { main: true });
    }
  });
}

/** Make a phone the user's preferred SMS destination. */
export async function setMainPhone(app: App, usrId: number, id: number): Promise<Row> {
  const db = app.db;
  await db.transaction(async () => {
    const row = await db.row`SELECT id FROM usr_phone WHERE id = ${id} AND usr_id = ${usrId}`;
    if (!row) throw new ApiError(404, "Phone number not found");
    await db.exec`UPDATE usr_phone SET main = ${false} WHERE usr_id = ${usrId}`;
    await db.table("usr_phone").update(id, { main: true });
  });
  return (await db.row`SELECT * FROM usr_phone WHERE id = ${id}`)!;
}

/** Every verified phone with its owner. */
export function phones(app: App, limit = 500): Promise<Row[]> {
  return app.db.query`
    SELECT p.id, p.usr_id, p.number, p.created, p.main, p.error, u.email
    FROM usr_phone p LEFT JOIN usr u ON u.id = p.usr_id
    ORDER BY p.created DESC LIMIT ${limit}`;
}

/** Normalize common formatting and require an international E.164 number. */
export function phoneNumber(input: string): string {
  let number = input.trim().replace(/[\s().-]/g, "");
  if (number.startsWith("00")) number = "+" + number.slice(2);
  if (!/^\+[1-9]\d{7,14}$/.test(number)) throw new ApiError(422, "Use an international phone number such as +41791234567");
  return number;
}
