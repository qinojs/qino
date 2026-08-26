// Public API of messaging. The qino plugin lives in ./plugin.ts.
import { sql, unixTime } from "@qino/qino";

import { dispatch } from "./lib/dispatch.ts";
import { textOf } from "./lib/format.ts";
import { owed } from "./lib/outbox.ts";

import type { Profile } from "./lib/format.ts";
import type { Rendering } from "./lib/dispatch.ts";

import type { App, Row, Sql } from "@qino/qino";

export { dropClaim, pendingContacts, redeemCode, requestCode } from "./lib/verify.ts";
export { contactRecipients } from "./lib/contact.ts";
export { ChannelError, delivered, run as outbox } from "./lib/outbox.ts";
export type { Rendering } from "./lib/dispatch.ts";
export { headers as unsubscribeHeaders } from "./lib/unsubscribe.ts";
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
 * `{ text }`. Channels add their own fields on top — a push tag, a mail `replyTo` — and degrade
 * what they cannot express instead of refusing it. What is on the wire is never one of them:
 * a caller says `format`, and the channel derives its own switches from that.
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
export type To = { grp?: number; usr?: number | number[]; all?: true; notClient?: string | number };

/** What a `To` selects on any table with a user column — the part every channel means the same
 *  way. A channel adds its own terms (a chat, a subscription) and ORs the lot together. */
export const selectors = (to: To, usr: string): Sql[] => [
  to.grp != null ? sql`${sql.raw(usr)} IN (SELECT usr_id FROM usr_grp WHERE grp_id = ${to.grp})` : null,
  to.usr != null ? sql.in(usr, [to.usr].flat()) : null,
  to.all ? sql`${true}` : null,
].flatMap((term) => term ?? []);

/** One destination a `To` turned out to mean. An address nobody can deliver to says why instead. */
export type Recipient = Row & { address: string; usrId?: number; addressError?: string };

/**
 * A way to reach a person, declared by a module as `export const messagingChannel`.
 *
 * `name` is what lands in the journal's `channel` column, so it outlives module renames. `reach`
 * answers how many destinations one user has, skipping `notClient` as `To` does.
 *
 * `contact` names the kind of address it delivers to — `usr_contact.type`, not the channel's own
 * name: sms, whatsapp and signal all reach a `phone`, and nobody proves the same number three
 * times. A Telegram chat and a push endpoint have none; those are linked, never entered.
 *
 * Sending has two halves: `recipients` — who a `to` means, the one question only the channel can
 * answer — and `deliver`, a batch on the wire. Everything between them is `send()`, for all of them.
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
  /** Each row closed with `delivered()`, resolving with how many went out. Handles of its own —
   *  a chat, a subscription — the channel looks up by `address`. */
  deliver(app: App, rows: Row[], msg: Msg, rendering: Rendering): Promise<number>;
};

/** Journal a message, then send it — a tracked link needs its delivery's id before it is written
 *  into the text. What is owed goes to the channel at once, the way the outbox hands it over later. */
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

/** The message with the title its channel needs: the text's first line where none was given. */
export function titled<T extends Msg>(message: string | T): T {
  const msg = msgOf(message);
  return { ...msg, title: titleOf(msg) };
}


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
 * The journal's free-form side: the caller's routing data, and beside it whatever of the message
 * only its channel understands — a push `url`, a mail `replyTo`. The columns hold what every
 * channel understands, this holds the rest, and together they are the whole message again.
 */
function journalData(data: Record<string, unknown> | undefined, msg?: Msg) {
  const { text: _text, title: _title, format: _format, template: _template, attachments: _attachments, ...rest } = msg ?? {} as Msg;
  return Object.keys(rest).length ? { ...data, msg: rest } : data ?? null;
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
  message: { channel: string; direction: "in" | "out"; msg?: string | Msg; data?: Record<string, unknown>; grpId?: number; logId?: number; time?: number },
  deliveries: { usrId?: number; address?: string; error?: string; sent?: number; due?: number }[] = [],
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
        due: delivery.due ?? null,
        sent: delivery.sent ?? null,
        error: delivery.error ?? null,
      })));
    }
  });
  return { id, ids };
}

