// Public API of messaging.email. The qino plugin lives in ./plugin.ts.
import { countContacts, errMsg } from "@qino/qino";
import { attachmentFile, ChannelError, contactRecipients, delivered, send as dispatch, titled, unsubscribeHeaders } from "@qino/qino/messaging";

import { addressOf, formatAddress } from "./lib/address.ts";
import { defaults } from "./lib/settings.ts";
import { createMessage, transport } from "./lib/transport.ts";

import type { App, Row } from "@qino/qino";
import type { Attachment, Channel, Msg, Recipient, Rendering, To } from "@qino/qino/messaging";

export { receive } from "./lib/inbound.ts";
export { setTransport } from "./lib/transport.ts";

/** Who a `to` means as mail addresses — `usr_contact` says where a person reads mail, one address
 *  each: the preferred one, else the oldest. A user without a mail contact simply drops out. */
async function recipients(app: App, to: To & { email?: string | string[] }): Promise<Recipient[]> {
  const literals = [to.email ?? []].flat().map((value) => addressOf(value) ?? {
    address: value.trim().slice(0, 191), addressError: BAD_ADDRESS,
  });
  if (to.grp == null && to.usr == null && !to.all && !literals.length) {
    throw new Error("send needs a recipient: { grp }, { usr }, { email } or { all: true }");
  }
  return (await contactRecipients(app, "email", to, literals)).map((row) => {
    const address = addressOf(row);
    return address ? { ...row, ...address } : { ...row, addressError: BAD_ADDRESS };
  });
}

const BAD_ADDRESS = "Use an email address such as name@example.com";

/**
 * Mail a group, a user, literal addresses, or everyone with an address.
 *
 * Resolves with the number of addresses reached. A mail needs a subject, so an absent title is
 * the first line of the text. `format` decides the body: markdown and html mails carry both an
 * HTML and a plain-text part, plain text goes out as text alone. `onError` observes rejected
 * deliveries without changing the numeric result.
 */
export const send = (
  app: App,
  to: To & { email?: string | string[] },
  message: string | Msg & { replyTo?: string },
  { onError }: { onError?: (message: string) => void } = {},
): Promise<number> => dispatch(app, messagingChannel, to, titled(message), { onError });

/** One batch of mails, over one connection. */
async function deliver(app: App, rows: Row[], msg: Msg & { replyTo?: string }, { render, uses, group }: Rendering): Promise<number> {
  const [config, mailer, attachments] = await Promise.all([defaults(app), transport(app), attachmentsOf(msg.attachments)]);
  if (!config.address) throw new ChannelError("Email has no system address. Set messaging.email.address.");
  const debug = config.debugTo ? addressOf(config.debugTo) : null;
  const detour = debug ? `redirected to debug address ${debug.address}` : undefined;
  const from = formatAddress({ address: config.address, name: config.name });
  let sent = 0;
  for (const row of rows) {
    const address = String(row.address);
    const usrId = Number(row.usr_id) || undefined;
    const grpId = group(row);
    // every mail carries a text part: plain readers and spam filters both want one
    const { text, html } = await render(row);
    // only where there is something to leave: the client's one-click way to the same link
    const leaving = uses.has("unsubscribe") && usrId && grpId ? await unsubscribeHeaders(app, usrId, grpId) : undefined;
    const failure = await transmit(mailer, {
      from,
      to: formatAddress(debug ?? { address, name: nameOf(row) }),
      replyTo: msg.replyTo || config.replyTo || undefined,
      subject: debug ? `Debug! ${msg.title}` : msg.title,
      content: html ? { html, text } : { text },
      attachments,
      headers: { ...leaving, ...debug ? { "X-Qino-Original-Recipient": address } : undefined },
    });
    // the transport took it, so it counts as sent — but nothing reached this address, and the
    // journal says so: an error is the absence of a delivery, not only a failure
    if (!failure) sent++;
    await delivered(app, Number(row.id), failure ?? detour);
  }
  // the pool serves this batch and nothing after it: a connection left open until the next mail is
  // one the server has long closed, and sending over it fails without saying why
  await mailer.closeAllConnections?.().catch(() => {});
  return sent;
}

const nameOf = (row: Row) => [row.given_name, row.family_name].filter(Boolean).join(" ") || undefined;

async function attachmentsOf(files?: Attachment[]): Promise<File[] | undefined> {
  return files?.length ? await Promise.all(files.map(attachmentFile)) : undefined;
}

/** Sends one mail; resolves with the error message instead of throwing, because the journal wants it.
 *  A failure that names no reason is a broken connection, never a refusal — the server that says no
 *  says why. Upyo keeps only `error.message` of what it caught, so an empty one is all that is left
 *  of it: worth one more mail on a fresh connection, and worth saying so when that fails too. */
async function transmit(
  mailer: Awaited<ReturnType<typeof transport>>,
  message: Record<string, unknown>,
  retry = true,
): Promise<Error | undefined> {
  try {
    const receipt = await mailer.send(await createMessage(message));
    if (receipt?.successful) return;
    const reason = receipt?.errorMessages?.join("\n").trim();
    if (!reason && retry) {
      await mailer.closeAllConnections?.().catch(() => {});
      return transmit(mailer, message, false);
    }
    // a server that refuses says why, and what it says is about this address
    return reason ? new Error(reason) : new ChannelError(`mail sending failed: ${JSON.stringify(receipt)}`);
  } catch (e) {
    console.warn("email: sending failed —", errMsg(e));
    return new ChannelError(errMsg(e).trim() || "mail sending failed");
  }
}

/** The channel this module is. */
export const messagingChannel: Channel = {
  name: "email",
  label: "Email",
  color: "--orange",
  contact: "email",
  reach: (app: App, usrId: number) => countContacts(app.db, usrId, "email"),
  recipients,
  send,
  deliver,
};
