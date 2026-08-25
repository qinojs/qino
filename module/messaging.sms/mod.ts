// Public API of messaging.sms. The qino plugin lives in ./plugin.ts.
import { addContact, ApiError, contactError, contactKey, contactOwner, errMsg, unixTime } from "@qino/qino";
import { ChannelError, contactRecipients, delivered, dropClaim, msgOf, owed, record, redeemCode, renderer, requestCode, unsubscribeGroup } from "@qino/qino/messaging";

import { deliver as transmit, setProvider } from "./lib/provider.ts";

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
  to: { grp?: number; usr?: number | number[]; all?: true; phone?: string | string[] },
  message: string | Msg,
): Promise<number> {
  const msg = msgOf(message);
  const direct = [to.phone ?? []].flat().map((input) => {
    try { return { address: contactKey("phone", input) }; }
    catch (e) { return { address: input.trim().slice(0, 191), addressError: errMsg(e) }; }
  });
  if (to.grp == null && to.usr == null && !to.all && !direct.length) {
    throw new Error("send needs a recipient: { grp }, { usr }, { phone } or { all: true }");
  }
  const time = unixTime();

  const [recipients, { render }] = await Promise.all([
    contactRecipients(app, "phone", to, direct),
    renderer(app, msg, "sms"),
  ]);
  const rows = recipients.map((row) => {
    if (row.addressError) return row;
    try { return { ...row, address: contactKey("phone", String(row.address)) }; }
    catch (e) { return { ...row, addressError: errMsg(e) }; }
  });
  // journaled first: a tracked link carries the delivery's own id
  const { ids } = await record(app, { channel: "sms", direction: "out", grpId: to.grp, msg, data: { to }, time },
    rows.map((row) => ({ usrId: row.usrId, address: row.address, ...owed(row.addressError, time) })));

  const leavable = await unsubscribeGroup(app, to.grp, rows.map((row) => row.usrId));
  let sent = 0;
  for (const [i, row] of rows.entries()) {
    if (row.addressError) continue;
    const address = String(row.address);
    const usrId = row.usrId;
    try {
      await transmit(app, address, await text(render, msg, { ...row, usrId, deliveryId: ids[i], grpId: leavable(usrId) }));
      await delivered(app, ids[i]);
      sent++;
      if (row.error) await contactError(app.db, "phone", address);
    } catch (e) {
      await delivered(app, ids[i], e);
      console.warn(`sms: ${address} rejected —`, errMsg(e));
      // our own failure says nothing about the number — the journal has it, the contact stays clean
      if (usrId && !(e instanceof ChannelError)) await contactError(app.db, "phone", address, errMsg(e));
    }
  }
  return sent;
}

/** One journalled delivery, sent again — the outbox's way in. */
export async function deliver(app: App, delivery: Row, msg: Msg): Promise<void> {
  const usrId = Number(delivery.usr_id) || undefined;
  const [{ render }, leavable] = await Promise.all([
    renderer(app, msg, "sms"),
    unsubscribeGroup(app, Number(delivery.grp_id) || undefined, [usrId]),
  ]);
  const body = await text(render, msg, { ...delivery, usrId, deliveryId: Number(delivery.id), grpId: leavable(usrId) });
  await transmit(app, String(delivery.address), body);
  await delivered(app, Number(delivery.id));
}

/** The message as SMS: one plain body, the title as its first line. */
async function text(render: (to?: Row) => Promise<{ text: string }>, msg: Msg, to: Row): Promise<string> {
  const body = (await render(to)).text;
  return msg.title ? `${msg.title}\n${body}` : body;
}

/** Claim a phone number and send its six-digit code. Nothing is stored on the user until it is verified. */
export async function addPhone(app: App, usrId: number, input: string): Promise<Row> {
  const number = contactKey("phone", input);
  const owner = await contactOwner(app.db, "phone", number);
  if (owner && owner !== usrId) throw new ApiError(409, "Phone number is unavailable");
  if (owner) return (await app.db.row`SELECT * FROM usr_contact WHERE type = ${"phone"} AND address = ${number}`)!;

  const time = unixTime();
  const code = await requestCode(app, "phone", usrId, number);
  const journal = (error?: string) =>
    record(app, { channel: "sms", direction: "out", data: { kind: "phone_verification" }, time }, [
      { usrId, address: number, error, sent: unixTime() },
    ]);
  try {
    await transmit(app, number, await app.t`Your verification code is ${code}.`);
  } catch (e) {
    await journal(errMsg(e));
    throw e;
  }
  await journal();
  return { address: number };
}

/** Redeem the code and make the number the user's. */
export async function verifyPhone(app: App, usrId: number, input: string, code: string): Promise<Row> {
  const number = contactKey("phone", input);
  await redeemCode(app, "phone", usrId, number, code);
  return addContact(app.db, usrId, "phone", number);
}

/** Take one user's claim as proven without its code; intended for trusted administration. */
export async function approvePhone(app: App, usrId: number, address: string): Promise<Row> {
  const claimed = await dropClaim(app, "phone", usrId, address);
  if (!claimed) throw new ApiError(404, "Nothing to verify");
  return addContact(app.db, Number(claimed.usr_id), "phone", String(claimed.address));
}
