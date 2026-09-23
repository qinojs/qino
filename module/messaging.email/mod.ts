import { countContacts, errMsg } from "@qino/qino";
import { attachmentFile, ChannelError, contactRecipients, delivered, send as dispatch, titled, unsubscribeHeaders } from "@qino/qino/messaging";

import { addressOf, formatAddress } from "./lib/address.ts";
import { defaults } from "./lib/settings.ts";
import { createMessage, transport } from "./lib/transport.ts";

import type { App, Row } from "@qino/qino";
import type { Attachment, Channel, Msg, Recipient, Rendering, To } from "@qino/qino/messaging";

export { receive } from "./lib/inbound.ts";
export { setTransport } from "./lib/transport.ts";

/** Resolve `to` to mail addresses: one per user (main, else oldest). Users without one are skipped. */
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
 * Mail a group, users, addresses, or everyone with an address.
 *
 * Resolves with the number of addresses reached. Subject: the title, else the first line. Markdown
 * and html mails get an HTML and a text part; plain text only a text part. `onError` reports
 * rejected deliveries.
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
    const result = await transmit(mailer, {
      from,
      to: formatAddress(debug ?? { address, name: nameOf(row) }),
      replyTo: msg.replyTo || config.replyTo || undefined,
      subject: debug ? `Debug! ${msg.title}` : msg.title,
      content: html ? { html, text } : { text },
      attachments,
      headers: { ...leaving, ...debug ? { "X-Qino-Original-Recipient": address } : undefined },
    });
    // counts as sent (the transport took it), but the journal notes the address wasn't reached
    const failure = result instanceof Error ? result : undefined;
    if (!failure) sent++;
    await delivered(app, Number(row.id), failure ?? detour, typeof result === "string" ? result : undefined);
  }
  // close the pool after the batch: the server closes idle connections, and reusing one fails silently
  await mailer.closeAllConnections?.().catch(() => {});
  return sent;
}

const nameOf = (row: Row) => [row.given_name, row.family_name].filter(Boolean).join(" ") || undefined;

async function attachmentsOf(files?: Attachment[]): Promise<File[] | undefined> {
  return files?.length ? await Promise.all(files.map(attachmentFile)) : undefined;
}

/** Send one mail; resolves with the message id, or the error (not thrown) for the journal.
 *  An error without message is a broken connection (a refusal always has a reason; Upyo keeps only
 *  `error.message`), so retry once on a new connection. */
async function transmit(
  mailer: Awaited<ReturnType<typeof transport>>,
  message: Record<string, unknown>,
  retry = true,
): Promise<Error | string | undefined> {
  try {
    const receipt = await mailer.send(await createMessage(message));
    if (receipt?.successful) return receipt.messageId;
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
