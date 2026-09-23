import { sql, unixTime } from "@qino/qino";

import { dispatch } from "./lib/dispatch.ts";
import { textOf } from "./lib/format.ts";
import { owed } from "./lib/outbox.ts";

import type { App, Row, Sql } from "@qino/qino";
import type { Profile } from "./lib/format.ts";
import type { Rendering } from "./lib/dispatch.ts";

export { dropClaim, pendingContacts, redeemCode, requestCode } from "./lib/verify.ts";
export { contactRecipients } from "./lib/contact.ts";
export { ChannelError, delivered, run as outbox } from "./lib/outbox.ts";
export type { Rendering } from "./lib/dispatch.ts";
export { headers as unsubscribeHeaders } from "./lib/unsubscribe.ts";
export { htmlOf, textOf } from "./lib/format.ts";
export { htmlToText } from "./lib/htmlText.ts";
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
 * The message, understood by every channel; a plain string is short for `{ text }`. Channels add
 * their own fields (a push tag, a mail `replyTo`) and adapt what they can't show. Transport
 * switches are never fields: the channel derives them from `format`.
 *
 * `format` says what the text *is*: markdown becomes the channel's markup, html becomes plain text
 * where needed, plain text (default) is sent as written. `title` is always plain text.
 *
 * `template`: the template to wrap it in — default the channel's main one, `null` for none. Applied
 * per recipient, never stored in the text.
 */
export type Msg = {
  text: string;
  title?: string;
  format?: "md" | "html";
  template?: string | null;
  /** Only channels that support attachments deliver them. */
  attachments?: Attachment[];
};

/** Turn the short attachment form into a `File`. */
export async function attachmentFile(file: Attachment): Promise<File> {
  if (!("content" in file)) return file;
  const content = await file.content;
  return new File([content instanceof Uint8Array ? new Uint8Array(content) : content], file.name, { type: file.type });
}

/** Normalize a message; a string becomes its text. */
export function msgOf<T extends Msg>(msg: string | T): T {
  return typeof msg === "string" ? { text: msg } as T : msg;
}

/** Title for channels that need one — else the first line of the text. */
export function titleOf(msg: Msg, max = 78): string {
  if (msg.title) return msg.title;
  const line = textOf(msg).trim().split("\n", 1)[0].trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(" ") + 1 || max).trimEnd() + "…";
}

/** Recipients; every channel understands these and adds its own keys. `notClient` is a device to
 *  skip — only device channels (webpush) use it. */
export type To = { grp?: number; usr?: number | number[]; all?: true; notClient?: string | number };

/** SQL condition for the common `To` keys on a table with a user column. Channels OR their own
 *  terms (chat, subscription) to it. */
export const selectors = (to: To, usr: string): Sql[] => [
  to.grp != null ? sql`${sql.raw(usr)} IN (SELECT usr_id FROM usr_grp WHERE grp_id = ${to.grp})` : null,
  to.usr != null ? sql.in(usr, [to.usr].flat()) : null,
  to.all ? sql`${true}` : null,
].flatMap((term) => term ?? []);

/** One resolved destination. An undeliverable address carries the reason instead. */
export type Recipient = Row & { address: string; usrId?: number; addressError?: string };

/**
 * A channel, declared by a module as `export const messagingChannel`.
 *
 * `name` is stored in the journal's `channel` column (survives module renames). `reach` counts a
 * user's destinations, skipping `notClient`.
 *
 * `contact` is the address kind it delivers to (`usr_contact.type`): sms, whatsapp and signal all use
 * `phone`. Telegram chats and push endpoints have none — they are linked, not entered.
 *
 * The channel provides `recipients` (resolve a `to`) and `deliver` (send a batch); `send()` does
 * everything in between.
 */
export type Channel = {
  name: string;
  label: string;
  color?: string;
  contact?: string;
  /** The markup this channel accepts; `html` unless it has a subset of its own. */
  profile?: Profile;
  reach(app: App, usrId: number, notClient?: string | number): Promise<number>;
  recipients(app: App, to: To): Promise<Recipient[]>;
  send(app: App, to: To, msg: string | Msg): Promise<number>;
  /** Close each row with `delivered()`; resolves with the number sent. The channel finds its own
   *  handles (chat, subscription) by `address`. */
  deliver(app: App, rows: Row[], msg: Msg, rendering: Rendering): Promise<number>;
};

/** Record a message, then send it (tracked links need the delivery id first). Due deliveries go
 *  to the channel right away, the same way the outbox does later. */
export async function send(
  app: App,
  channel: Channel,
  to: To,
  message: string | Msg,
  { onError }: { onError?: (message: string) => void } = {},
): Promise<number> {
  const msg = msgOf(message);
  const time = unixTime();
  const recipients = await channel.recipients(app, to);
  if (!recipients.length) return 0;
  const { ids } = await record(app, { channel: channel.name, direction: "out", grpId: to.grp, msg, data: { to }, time },
    recipients.map((r) => ({ usrId: r.usrId, address: r.address, ...owed(r.addressError, time) })));
  return dispatch(app, channel, ids, msg, onError);
}

/** The message with a title: the first line of the text if none was given. */
export function titled<T extends Msg>(message: string | T): T {
  const msg = msgOf(message);
  return { ...msg, title: titleOf(msg) };
}

/** All channels of linked modules. */
export function channels(app: App): Channel[] {
  return app.modules.linked().filter((mod) => mod.plugin.messagingChannel).map((mod) => mod.plugin.messagingChannel as Channel);
}

export function channel(app: App, name: string): Channel | undefined {
  return channels(app).find((c) => c.name === name);
}

/** Channels that can reach this user. */
export async function userChannels(app: App, usrId: number): Promise<Channel[]> {
  const all = channels(app);
  const reach = await Promise.all(all.map((c) => c.reach(app, usrId).catch(() => 0)));
  return all.filter((_, i) => reach[i] > 0);
}

/**
 * The journal's `data`: the caller's routing data plus channel-specific message fields (a push
 * `url`, a mail `replyTo`). Together with the columns it is the whole message.
 */
function journalData(data: Record<string, unknown> | undefined, msg?: Msg) {
  const { text: _text, title: _title, format: _format, template: _template, attachments: _attachments, ...rest } = msg ?? {} as Msg;
  return Object.keys(rest).length ? { ...data, msg: rest } : data ?? null;
}

/**
 * Store one message and one row per recipient.
 *
 * `msg` goes into its own columns, so the journal can be read without knowing channels; `data` is
 * the channel's payload and routing.
 *
 * Record first, then send: `ids` are the delivery rows in the given order (tracked links need
 * them); `delivered()` stores the outcome.
 */
export async function record(
  app: App,
  message: { channel: string; direction: "in" | "out"; msg?: string | Msg; data?: Record<string, unknown>; grpId?: number; logId?: number; time?: number },
  deliveries: { usrId?: number; address?: string; ref?: string; error?: string; sent?: number; due?: number }[] = [],
): Promise<{ id: number; ids: number[] }> {
  if (!message.channel) throw new Error("message channel is required");
  const time = message.time ?? unixTime();
  const msg = message.msg == null ? undefined : msgOf(message.msg);
  const files = msg?.attachments?.length
    ? await Promise.all(msg.attachments.map(async (attachment) => app.dbFiles.add(await attachmentFile(attachment))))
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
      data: JSON.stringify(journalData(message.data, msg)),
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
        ref: delivery.ref ?? null,
        due: delivery.due ?? null,
        sent: delivery.sent ?? null,
        error: delivery.error ?? null,
      })));
    }
  });
  return { id, ids };
}
