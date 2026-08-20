// Public API of messaging.email. The qino plugin lives in ./plugin.ts.
import { errMsg, sql, unixTime } from "@qino/qino";
import { msgOf, record, titleOf } from "@qino/qino/messaging";

import { addressOf, formatAddress } from "./lib/address.ts";
import { defaults } from "./lib/settings.ts";
import { createMessage, transport } from "./lib/transport.ts";

import type { App } from "@qino/qino";
import type { Msg } from "@qino/qino/messaging";

export { receive } from "./lib/inbound.ts";
export { setTransport } from "./lib/transport.ts";

/**
 * Deliver a mail to a group, a user, literal addresses, or everyone with an address.
 *
 * Resolves with the number of addresses reached. A mail needs a subject, so an absent title is
 * the first line of the text; without `html` it goes out as plain text.
 */
export async function send(
  app: App,
  to: { grp?: number; usr?: number; all?: true; email?: string | string[] },
  message: string | Msg & { html?: string },
): Promise<number> {
  const given = msgOf(message);
  const msg = { ...given, title: titleOf(given) }; // journal what was really sent, derived title included
  const recipients = await addresses(app, to);
  if (!recipients.length) return 0;

  const time = unixTime();
  const [config, mailer] = await Promise.all([defaults(app), transport(app)]);
  if (!config.sender) throw new Error("Email has no sender. Set messaging.email.sender.");
  const debug = config.debugTo ? addressOf(config.debugTo) : null;
  const from = formatAddress({ address: config.sender, name: config.sendername });

  const deliveries = [];
  let sent = 0;
  for (const recipient of recipients) {
    const error = await deliver(mailer, {
      from,
      to: formatAddress(debug ?? recipient),
      replyTo: config.replyTo || undefined,
      subject: debug ? `Debug! ${msg.title}` : msg.title,
      content: msg.html ? { html: msg.html, text: msg.text } : { text: msg.text },
      headers: debug ? { "X-Qino-Original-Recipient": recipient.address } : undefined,
    });
    // the transport took it, so it counts as sent — but nothing reached this address, and the
    // journal says so: an error is the absence of a delivery, not only a failure
    if (!error) sent++;
    deliveries.push({
      usrId: recipient.usrId,
      address: recipient.address,
      error: error ?? (debug ? `redirected to debug address ${debug.address}` : undefined),
      time: unixTime(),
    });
  }
  await record(app, { channel: "email", direction: "out", grpId: to.grp, msg, data: { to }, time }, deliveries);
  return sent;
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

/** Who a `to` means, as addresses; a user without an address simply drops out. */
async function addresses(app: App, to: { grp?: number; usr?: number; all?: true; email?: string | string[] }) {
  const literals = [to.email ?? []].flat().flatMap((v) => addressOf(v) ?? []);
  const who = to.grp != null ? sql`id IN (SELECT usr_id FROM usr_grp WHERE grp_id = ${to.grp})`
    : to.usr != null ? sql`id = ${to.usr}`
    : to.all ? sql`${true}`
    // an address is journaled as its owner's when one owns it, so the mail joins their conversation
    : literals.length ? sql`email IN (${sql.join(literals.map((a) => sql`${a.address}`), ", ")})`
    : null;
  if (!who) throw new Error("send needs a recipient: { grp }, { usr }, { email } or { all: true }");

  const found = new Map(literals.map((a) => [a.address, a]));
  const rows = await app.db.query`SELECT id, email, firstname, lastname FROM usr WHERE ${who}`;
  for (const row of rows) {
    const name = [row.firstname, row.lastname].filter(Boolean).join(" ");
    const address = addressOf({ address: String(row.email ?? ""), name, usrId: Number(row.id) });
    if (address) found.set(address.address, address);
  }
  return [...found.values()];
}
