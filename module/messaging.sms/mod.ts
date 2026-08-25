// Public API of messaging.sms. The qino plugin lives in ./plugin.ts.
import { addContact, ApiError, contactKey, contactOwner, countContacts, errMsg, unixTime } from "@qino/qino";
import { contactRecipients, delivered, dropClaim, record, redeemCode, requestCode, send as dispatch } from "@qino/qino/messaging";

import { deliver as transmit, setProvider } from "./lib/provider.ts";

import type { App, Row } from "@qino/qino";
import type { Channel, Msg, Recipient, Rendering, To } from "@qino/qino/messaging";
import type { SmsProvider } from "./lib/provider.ts";

export { setProvider, type SmsProvider };

/**
 * Who a `to` means as phone numbers — `usr_contact` holds verified numbers only, so a group or
 * user selection needs no filtering. `{ phone }` is the number itself and reaches it whether or
 * not anyone verified it; a number that is somebody's is journaled as theirs.
 */
async function recipients(app: App, to: To & { phone?: string | string[] }): Promise<Recipient[]> {
  const direct = [to.phone ?? []].flat().map(normalize);
  if (to.grp == null && to.usr == null && !to.all && !direct.length) {
    throw new Error("send needs a recipient: { grp }, { usr }, { phone } or { all: true }");
  }
  return (await contactRecipients(app, "phone", to, direct)).map((row) => row.addressError ? row : { ...row, ...normalize(row.address) });
}

/** A number as E.164, or the reason it is not one. */
function normalize(input: string): { address: string; addressError?: string } {
  try { return { address: contactKey("phone", input) }; }
  catch (e) { return { address: input.trim().slice(0, 191), addressError: errMsg(e) }; }
}

/**
 * Text the numbers of a group, user, one number, or everyone. An SMS is text and nothing else:
 * markup is flattened and a `title` becomes the first line.
 */
export const send = (app: App, to: To & { phone?: string | string[] }, message: string | Msg): Promise<number> =>
  dispatch(app, messagingChannel, to, message);

/** One batch of texts. */
async function deliver(app: App, rows: Row[], msg: Msg, { render }: Rendering): Promise<number> {
  let sent = 0;
  for (const row of rows) {
    const address = String(row.address);
    const body = (await render(row)).text;
    try {
      await transmit(app, address, msg.title ? `${msg.title}\n${body}` : body);
      await delivered(app, Number(row.id));
      sent++;
    } catch (e) {
      await delivered(app, Number(row.id), e);
      console.warn(`sms: ${address} rejected —`, errMsg(e));
    }
  }
  return sent;
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

/** The channel this module is. */
export const messagingChannel: Channel = {
  name: "sms",
  label: "SMS",
  color: "--green",
  contact: "phone",
  reach: (app: App, usrId: number) => countContacts(app.db, usrId, "phone"),
  recipients,
  send,
  deliver,
};
