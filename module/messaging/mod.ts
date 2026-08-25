// Public API of messaging. The qino plugin lives in ./plugin.ts.
import { sql, unixTime } from "@qino/qino";

import { textOf } from "./lib/format.ts";

import type { App, Row } from "@qino/qino";

export { dropClaim, pendingContacts, redeemCode, requestCode } from "./lib/verify.ts";
export { contactRecipients } from "./lib/contact.ts";
export { headers as unsubscribeHeaders, unsubscribeGroup } from "./lib/unsubscribe.ts";
export { htmlOf, textOf } from "./lib/format.ts";
export { placeholderName, renderer, saveTemplate, templated, templates } from "./lib/template.ts";
export { sanitizeHtml } from "./lib/sanitize.ts";
export type { Computed, Placeholder } from "./lib/template.ts";

/** A named file carried by channels that support attachments. */
export type Attachment = File | {
  name: string;
  type?: string;
  content: Uint8Array | Promise<Uint8Array> | Blob | string;
};

/**
 * What every channel understands. `text` is the message; a bare string is the short form of
 * `{ text }`. Channels add their own fields on top — a push title, a mail subject, a Telegram
 * `parse_mode` — and degrade what they cannot express instead of refusing it.
 *
 * `format` says what the text *is*, not how it is delivered: markdown renders to the markup a
 * channel accepts, html degrades to plain text where none is possible, and the default — plain
 * text — goes out exactly as it was written. `title` is always plain text.
 *
 * `template` names the template around it — the channel's main one when unnamed, and `null` for a
 * message that goes out bare. The template is chrome: applied per recipient, never part of the text.
 */
export type Msg = {
  text: string;
  title?: string;
  format?: "md" | "html";
  template?: string | null;
  /** Only channels that support attachments deliver them. */
  attachments?: Attachment[];
};

/** Materialize the compact attachment form as a Web-standard file. */
export async function attachmentFile(file: Attachment): Promise<File> {
  if (!("content" in file)) return file;
  const content = await file.content;
  return new File([content instanceof Uint8Array ? new Uint8Array(content) : content], file.name, { type: file.type });
}

/** The normal form of a message; a bare string is its text. */
export function msgOf<T extends Msg>(msg: string | T): T {
  return typeof msg === "string" ? { text: msg } as T : msg;
}

/** A title for the channels that need one — the first line of the text when none was given. */
export function titleOf(msg: Msg, max = 78): string {
  if (msg.title) return msg.title;
  const line = textOf(msg).trim().split("\n", 1)[0].trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(" ") + 1 || max).trimEnd() + "…";
}

/** Who a message goes to; every channel understands these and adds its own keys.
 *  `notClient` names the device that must be skipped — a channel that reaches devices honours it,
 *  one that is out of band by nature (sms, mail, telegram) has none and ignores it. */
type To = { grp?: number; usr?: number; all?: true; notClient?: string | number };

/**
 * A way to reach a person, declared by a module as `export const messagingChannel`.
 *
 * `name` is what lands in the journal's `channel` column, so it outlives module renames.
 * `reach` answers how many destinations one user has, skipping `notClient` as `To` does; `send` is
 * the module's own send() — the declaration is the same function, not a wrapper around it.
 *
 * `contact` names the kind of address it delivers to — `usr_contact.type`, not the channel's own
 * name: sms, whatsapp and signal all reach a `phone`, and nobody proves the same number three
 * times. A Telegram chat and a push endpoint have none; those are linked, never entered.
 */
export type Channel = {
  name: string;
  label: string;
  color?: string;
  contact?: string;
  reach(app: App, usrId: number, notClient?: string | number): Promise<number>;
  send(app: App, to: To, msg: string | Msg): Promise<number>;
};


/** Every channel a linked module declares. */
export function channels(app: App): Channel[] {
  return app.modules.linked().filter((mod) => mod.plugin.messagingChannel).map((mod) => mod.plugin.messagingChannel as Channel);
}

export function channel(app: App, name: string): Channel | undefined {
  return channels(app).find((c) => c.name === name);
}

/** The channels one user can actually be reached on. */
export async function userChannels(app: App, usrId: number): Promise<Channel[]> {
  const all = channels(app);
  const reach = await Promise.all(all.map((c) => c.reach(app, usrId).catch(() => 0)));
  return all.filter((_, i) => reach[i] > 0);
}

/**
 * Store one logical message and one row per recipient.
 *
 * `msg` is the channel-neutral part and lands in its own columns, so reading and searching the
 * journal needs no knowledge of any channel; `data` stays the channel-native payload and routing.
 *
 * Journal first, send after: `ids` are the delivery rows in the order they were given — a tracked
 * link needs one before it is written into the message, and `delivered()` says how it went.
 */
export async function record(
  app: App,
  message: { channel: string; direction: "in" | "out"; msg?: string | Msg; data?: unknown; grpId?: number; logId?: number; time?: number },
  deliveries: { usrId?: number; address?: string; error?: string; time?: number }[] = [],
): Promise<{ id: number; ids: number[] }> {
  if (!message.channel) throw new Error("message channel is required");
  const time = message.time ?? unixTime();
  const msg = message.msg == null ? undefined : msgOf(message.msg);
  const files = msg?.attachments?.length
    ? await Promise.all(msg.attachments.map(async (attachment) => await app.dbFiles.add(await attachmentFile(attachment))))
    : [];
  let id = 0;
  const ids: number[] = [];
  await app.db.transaction(async () => {
    id = Number(await app.db.table("message").insert({
      channel: message.channel,
      direction: message.direction,
      grp_id: message.grpId ?? null,
      log_id: message.logId ?? null,
      title: msg?.title?.slice(0, 191) ?? null,
      text: msg?.text ?? null,
      format: msg?.format ?? null,
      template: msg?.template ?? null,
      data: JSON.stringify(message.data ?? null),
      time,
    }));
    const attachments = app.db.table("message_attachment");
    for (const [sort, file] of files.entries()) await attachments.insert({ message_id: id, file_id: file.id, sort });
    const table = app.db.table("message_delivery");
    for (const delivery of deliveries) {
      ids.push(Number(await table.insert({
        message_id: id,
        usr_id: delivery.usrId ?? null,
        address: delivery.address ?? null,
        time: delivery.time ?? unixTime(),
        error: delivery.error ?? null,
      })));
    }
  });
  return { id, ids };
}

/** How one attempt went, written back to the row a tracked link points at. */
export function delivered(app: App, id: number, error?: string): Promise<unknown> {
  return app.db.table("message_delivery").update(id, { error: error ?? null, time: unixTime() });
}

type JournalMessage = Row & { deliveries: Row[]; attachments: Row[] };

/** Recent logical messages including their recipient and attachment detail rows. */
export function messages(app: App, limit = 100): Promise<JournalMessage[]> {
  return read(app, limit);
}

/** Recent messages sent to or received from one user. */
export function userMessages(app: App, usrId: number, limit?: number): Promise<JournalMessage[]> {
  return read(app, limit, usrId);
}

async function read(app: App, limit?: number, usrId?: number): Promise<JournalMessage[]> {
  const where = usrId == null ? sql`` : sql`WHERE EXISTS (
    SELECT 1 FROM message_delivery selected
    WHERE selected.message_id = m.id AND selected.usr_id = ${usrId}
  )`;
  const delivery = usrId == null ? sql`` : sql`AND d.usr_id = ${usrId}`;
  const take = limit == null ? sql`` : sql`LIMIT ${limit}`;
  const rows = await app.db.query`
    SELECT m.id, m.channel, m.direction, m.grp_id, m.log_id, m.title, m.text, m.format, m.template, m.data, m.time,
      (SELECT COUNT(*) FROM message_delivery md WHERE md.message_id = m.id) AS recipient_count,
      g.name AS grp_name, d.id AS delivery_id, d.usr_id, d.address, d.time AS delivery_time,
      d.error, u.email
    FROM (SELECT m.* FROM message m ${where} ORDER BY m.time DESC, m.id DESC ${take}) m
    LEFT JOIN grp g ON g.id = m.grp_id
    LEFT JOIN message_delivery d ON d.message_id = m.id ${delivery}
    LEFT JOIN usr u ON u.id = d.usr_id
    ORDER BY m.time DESC, m.id DESC, d.id`;
  const byId = new Map<number, JournalMessage>();
  for (const row of rows) {
    const id = Number(row.id);
    const message = byId.getOrInsertComputed(id, () => ({
      id: row.id,
      channel: row.channel,
      direction: row.direction,
      grp_id: row.grp_id,
      grp_name: row.grp_name,
      log_id: row.log_id,
      title: row.title,
      text: row.text,
      format: row.format,
      template: row.template,
      data: row.data,
      time: row.time,
      recipient_count: row.recipient_count,
      deliveries: [],
      attachments: [],
    }));
    if (row.delivery_id != null) message.deliveries.push({
      id: row.delivery_id,
      usr_id: row.usr_id,
      address: row.address,
      email: row.email,
      time: row.delivery_time,
      error: row.error,
    });
  }
  const messages = [...byId.values()];
  if (!messages.length) return messages;
  const ids = sql.join(messages.map((message) => sql`${message.id}`), ", ");
  const links = await app.db.query`
    SELECT a.message_id, a.file_id, a.sort FROM message_attachment a
    WHERE a.message_id IN (${ids})
    ORDER BY a.message_id, a.sort, a.file_id`;
  if (!links.length) return messages;
  const fileIds = sql.join(links.map((link) => sql`${link.file_id}`), ", ");
  const files = new Map((await app.db.query`
    SELECT id, name, mime, size FROM file WHERE id IN (${fileIds})`
  ).map((file) => [Number(file.id), file]));
  for (const link of links) {
    const file = files.get(Number(link.file_id));
    if (!file) continue;
    byId.get(Number(link.message_id))?.attachments.push({ file_id: link.file_id, name: file.name, mime: file.mime, size: file.size, sort: link.sort });
  }
  return messages;
}
