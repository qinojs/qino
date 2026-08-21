// Public API of messaging.email. The qino plugin lives in ./plugin.ts.
import { contactError, errMsg, sql, unixTime } from "@qino/qino";
import { attachmentFile, delivered, msgOf, record, renderer, titleOf } from "@qino/qino/messaging";

import { addressOf, formatAddress } from "./lib/address.ts";
import { defaults } from "./lib/settings.ts";
import { createMessage, transport } from "./lib/transport.ts";

import type { App, Row } from "@qino/qino";
import type { Attachment, Msg } from "@qino/qino/messaging";

export { receive } from "./lib/inbound.ts";
export { setTransport } from "./lib/transport.ts";

/**
 * Deliver a mail to a group, a user, literal addresses, or everyone with an address.
 *
 * Resolves with the number of addresses reached. A mail needs a subject, so an absent title is
 * the first line of the text. `format` decides the body: markdown and html mails carry both an
 * HTML and a plain-text part, plain text goes out as text alone.
 */
export async function send(
  app: App,
  to: { grp?: number; usr?: number; all?: true; email?: string | string[] },
  message: string | Msg,
): Promise<number> {
  const given = msgOf(message);
  const msg = { ...given, title: titleOf(given) }; // journal what was really sent, derived title included
  const recipients = await addresses(app, to);
  if (!recipients.length) return 0;

  const time = unixTime();
  const [config, mailer, render] = await Promise.all([defaults(app), transport(app), renderer(app, msg, "email")]);
  if (!config.sender) throw new Error("Email has no sender. Set messaging.email.sender.");
  const debug = config.debugTo ? addressOf(config.debugTo) : null;
  const detour = debug ? `redirected to debug address ${debug.address}` : undefined;
  const from = formatAddress({ address: config.sender, name: config.sendername });
  const attachments = await attachmentsOf(msg.attachments);

  // journaled first: a tracked link carries the delivery's own id
  const { ids } = await record(app, {
    channel: "email",
    direction: "out",
    grpId: to.grp,
    msg: attachments ? { ...msg, attachments } : msg,
    data: { to },
    time,
  }, recipients.map((recipient) => ({ usrId: recipient.usrId, address: recipient.address, time })));

  let sent = 0;
  for (const [i, recipient] of recipients.entries()) {
    // every mail carries a text part: plain readers and spam filters both want one
    const { text, html } = await render({ ...recipient, deliveryId: ids[i] });
    const error = await deliver(mailer, {
      from,
      to: formatAddress(debug ?? recipient),
      replyTo: config.replyTo || undefined,
      subject: debug ? `Debug! ${msg.title}` : msg.title,
      content: html ? { html, text } : { text },
      attachments,
      headers: debug ? { "X-Qino-Original-Recipient": recipient.address } : undefined,
    });
    // the transport took it, so it counts as sent — but nothing reached this address, and the
    // journal says so: an error is the absence of a delivery, not only a failure
    if (!error) sent++;
    // a contact that bounces says so in the panel; the journal keeps the detail
    if (recipient.usrId) contactError(app.db, "email", recipient.address, error);
    // a plain success is already what the journal says
    if (error || detour) await delivered(app, ids[i], error ?? detour);
  }
  return sent;
}

async function attachmentsOf(files?: Attachment[]): Promise<File[] | undefined> {
  return files?.length ? await Promise.all(files.map(attachmentFile)) : undefined;
}

/** Sends one mail; resolves with the error message instead of throwing, because the journal wants it. */
async function deliver(mailer: Awaited<ReturnType<typeof transport>>, message: Record<string, unknown>): Promise<string | undefined> {
  try {
    const receipt = await mailer.send(await createMessage(message));
    if (receipt?.successful) return;
    return receipt?.errorMessages?.join("\n") ?? "mail sending failed";
  } catch (e) {
    console.warn("email: sending failed —", errMsg(e));
    return errMsg(e);
  }
}

/** Who a `to` means, as addresses — `usr_contact` says where a person reads mail, one address each:
 *  the preferred one, else the oldest. A user without a mail contact simply drops out. */
async function addresses(app: App, to: { grp?: number; usr?: number; all?: true; email?: string | string[] }) {
  const literals = [to.email ?? []].flat().flatMap((v) => addressOf(v) ?? []);
  const who = to.grp != null ? sql`c.usr_id IN (SELECT usr_id FROM usr_grp WHERE grp_id = ${to.grp})`
    : to.usr != null ? sql`c.usr_id = ${to.usr}`
    : to.all ? sql`${true}`
    : null;
  if (!who && !literals.length) throw new Error("send needs a recipient: { grp }, { usr }, { email } or { all: true }");

  // the recipient is also what a template greets, so the user's columns travel with the address
  const found = new Map<string, Row & { address: string; name?: string; usrId?: number }>(literals.map((a) => [a.address, a]));
  // an address that is somebody's is journaled as theirs, so the mail joins their conversation
  const mine = literals.length
    ? sql`c.address IN (${sql.join(literals.map((a) => sql`${a.address}`), ", ")})`
    : null;
  const pick = who
    ? sql`(${who}) AND c.address = (
      SELECT other.address FROM usr_contact other
      WHERE other.type = ${"email"} AND other.usr_id = c.usr_id
      ORDER BY other.main DESC, other.created, other.address LIMIT 1)`
    : null;
  const rows = await app.db.query`
    SELECT c.usr_id, c.address, u.firstname, u.lastname, u.company, u.email FROM usr_contact c
    LEFT JOIN usr u ON u.id = c.usr_id
    WHERE c.type = ${"email"} AND (${sql.join([pick, mine].flatMap((v) => v ?? []), " OR ")})`;
  for (const row of rows) {
    const name = [row.firstname, row.lastname].filter(Boolean).join(" ");
    const address = addressOf({ address: String(row.address ?? ""), name, usrId: Number(row.usr_id) });
    if (address) found.set(address.address, { ...row, ...address });
  }
  return [...found.values()];
}
