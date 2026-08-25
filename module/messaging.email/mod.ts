// Public API of messaging.email. The qino plugin lives in ./plugin.ts.
import { contactError, errMsg, unixTime } from "@qino/qino";
import { attachmentFile, contactRecipients, delivered, msgOf, record, renderer, titleOf, unsubscribeHeaders } from "@qino/qino/messaging";

import { addressOf, formatAddress } from "./lib/address.ts";
import { defaults } from "./lib/settings.ts";
import { createMessage, transport } from "./lib/transport.ts";

import type { App } from "@qino/qino";
import type { Attachment, Msg } from "@qino/qino/messaging";

export { receive } from "./lib/inbound.ts";
export { setTransport } from "./lib/transport.ts";

/**
 * Deliver a mail to a group, a user, literal addresses, or everyone with an address.
 *
 * Resolves with the number of addresses reached. A mail needs a subject, so an absent title is
 * the first line of the text. `format` decides the body: markdown and html mails carry both an
 * HTML and a plain-text part, plain text goes out as text alone. `onError` observes rejected
 * deliveries without changing the numeric result.
 */
export async function send(
  app: App,
  to: { grp?: number; usr?: number; all?: true; email?: string | string[] },
  message: string | Msg & { replyTo?: string }, // replyTo: where an answer belongs, overriding the inbox
  { onError }: { onError?: (message: string) => void } = {},
): Promise<number> {
  const given = msgOf(message);
  const msg = { ...given, title: titleOf(given) }; // journal what was really sent, derived title included
  const recipients = await addresses(app, to);
  if (!recipients.length) return 0;

  const time = unixTime();
  const [config, mailer, { render, uses }] = await Promise.all([defaults(app), transport(app), renderer(app, msg, "email")]);
  if (!config.address) throw new Error("Email has no system address. Set messaging.email.address.");
  const debug = config.debugTo ? addressOf(config.debugTo) : null;
  const detour = debug ? `redirected to debug address ${debug.address}` : undefined;
  const from = formatAddress({ address: config.address, name: config.name });
  const attachments = await attachmentsOf(msg.attachments);

  // journaled first: a tracked link carries the delivery's own id
  const { ids } = await record(app, {
    channel: "email",
    direction: "out",
    grpId: to.grp,
    msg: attachments ? { ...msg, attachments } : msg,
    data: { to },
    time,
  }, recipients.map((recipient) => ({ usrId: recipient.usrId, address: recipient.address, error: recipient.addressError, time })));

  let sent = 0;
  for (const [i, recipient] of recipients.entries()) {
    if (recipient.addressError) {
      onError?.(recipient.addressError);
      continue;
    }
    // every mail carries a text part: plain readers and spam filters both want one
    const { text, html } = await render({ ...recipient, deliveryId: ids[i], grpId: to.grp });
    // only where there is something to leave: the client's one-click way to the same link
    const leaving = uses.has("unsubscribe") && recipient.usrId && to.grp
      ? await unsubscribeHeaders(app, recipient.usrId, to.grp)
      : undefined;
    const error = await deliver(mailer, {
      from,
      to: formatAddress(debug ?? recipient),
      replyTo: msg.replyTo || config.replyTo || undefined,
      subject: debug ? `Debug! ${msg.title}` : msg.title,
      content: html ? { html, text } : { text },
      attachments,
      headers: { ...leaving, ...debug ? { "X-Qino-Original-Recipient": recipient.address } : undefined },
    });
    if (error) onError?.(error);
    // the transport took it, so it counts as sent — but nothing reached this address, and the
    // journal says so: an error is the absence of a delivery, not only a failure
    if (!error) sent++;
    // a contact that bounces says so in the panel; the journal keeps the detail
    if (recipient.usrId) contactError(app.db, "email", recipient.address, error);
    // a plain success is already what the journal says
    if (error || detour) await delivered(app, ids[i], error ?? detour);
  }
  // the pool serves this batch and nothing after it: a connection left open until the next mail is
  // one the server has long closed, and sending over it fails without saying why
  await mailer.closeAllConnections?.().catch(() => {});
  return sent;
}

async function attachmentsOf(files?: Attachment[]): Promise<File[] | undefined> {
  return files?.length ? await Promise.all(files.map(attachmentFile)) : undefined;
}

/** Sends one mail; resolves with the error message instead of throwing, because the journal wants it.
 *  A failure that names no reason is a broken connection, never a refusal — the server that says no
 *  says why. Upyo keeps only `error.message` of what it caught, so an empty one is all that is left
 *  of it: worth one more mail on a fresh connection, and worth saying so when that fails too. */
async function deliver(
  mailer: Awaited<ReturnType<typeof transport>>,
  message: Record<string, unknown>,
  retry = true,
): Promise<string | undefined> {
  try {
    const receipt = await mailer.send(await createMessage(message));
    if (receipt?.successful) return;
    const reason = receipt?.errorMessages?.join("\n").trim();
    if (!reason && retry) {
      await mailer.closeAllConnections?.().catch(() => {});
      return deliver(mailer, message, false);
    }
    return reason || `mail sending failed: ${JSON.stringify(receipt)}`;
  } catch (e) {
    console.warn("email: sending failed —", errMsg(e));
    return errMsg(e).trim() || "mail sending failed";
  }
}

/** Who a `to` means, as addresses — `usr_contact` says where a person reads mail, one address each:
 *  the preferred one, else the oldest. A user without a mail contact simply drops out. */
async function addresses(app: App, to: { grp?: number; usr?: number; all?: true; email?: string | string[] }) {
  const literals = [to.email ?? []].flat().map((value) => addressOf(value) ?? {
    address: value.trim().slice(0, 191), addressError: "Use an email address such as name@example.com",
  });
  if (to.grp == null && to.usr == null && !to.all && !literals.length) {
    throw new Error("send needs a recipient: { grp }, { usr }, { email } or { all: true }");
  }
  return (await contactRecipients(app, "email", to, literals)).map((row) => {
    const name = [row.firstname, row.lastname].filter(Boolean).join(" ");
    const address = addressOf({ ...row, name: name || row.name, usrId: row.usrId });
    return address ? { ...row, ...address } : { ...row, addressError: "Use an email address such as name@example.com" };
  });
}
