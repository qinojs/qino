// Public API of messaging. The qino plugin lives in ./plugin.ts.
import { sql, unixTime } from "@qino/qino";

import type { App, Row } from "@qino/qino";

export { dropClaim, pendingContacts, redeemCode, requestCode } from "./lib/verify.ts";

/**
 * What every channel understands. `text` is the message; a bare string is the short form of
 * `{ text }`. Channels add their own fields on top — a push title, a mail subject, a Telegram
 * `parse_mode` — and degrade what they cannot express instead of refusing it.
 */
export type Msg = { text: string; title?: string };

/** The normal form of a message; a bare string is its text. */
export function msgOf<T extends Msg>(msg: string | T): T {
  return typeof msg === "string" ? { text: msg } as T : msg;
}

/** A title for the channels that need one — the first line of the text when none was given. */
export function titleOf(msg: Msg, max = 78): string {
  if (msg.title) return msg.title;
  const line = msg.text.trim().split("\n", 1)[0].trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(" ") + 1 || max).trimEnd() + "…";
}

/** Who a message goes to; every channel understands these and adds its own keys. */
export type To = { grp?: number; usr?: number; all?: true };

/**
 * A way to reach a person, declared by a module as `export const messagingChannel`.
 *
 * `name` is what lands in the journal's `channel` column, so it outlives module renames.
 * `reach` answers how many destinations one user has; `send` is the module's own send() —
 * the declaration is the same function, not a wrapper around it.
 */
export type Channel = {
  name: string;
  label: string;
  color?: string;
  reach(app: App, usrId: number): Promise<number>;
  send(app: App, to: To, msg: string | Msg): Promise<number>;
};

/** Every channel a linked module declares. */
export function channels(app: App): Channel[] {
  return Object.values(app.modules.all())
    .filter((mod) => mod.plugin.messagingChannel && app.modules.linked(mod.name))
    .map((mod) => mod.plugin.messagingChannel as Channel);
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

/** Store one logical message and one result per recipient. */
export async function record(
  app: App,
  message: { channel: string; direction: "in" | "out"; data?: unknown; grpId?: number; logId?: number; time?: number },
  deliveries: { usrId?: number; address?: string; error?: string; time?: number }[] = [],
): Promise<number> {
  if (!message.channel) throw new Error("message channel is required");
  const time = message.time ?? unixTime();
  let id = 0;
  await app.db.transaction(async () => {
    id = Number(await app.db.table("message").insert({
      channel: message.channel,
      direction: message.direction,
      grp_id: message.grpId ?? null,
      log_id: message.logId ?? null,
      data: JSON.stringify(message.data ?? null),
      time,
    }));
    const table = app.db.table("message_delivery");
    for (const delivery of deliveries) {
      await table.insert({
        message_id: id,
        usr_id: delivery.usrId ?? null,
        address: delivery.address ?? null,
        time: delivery.time ?? unixTime(),
        error: delivery.error ?? null,
      });
    }
  });
  return id;
}

/** Recent logical messages including their recipient detail rows. */
export function messages(app: App, limit = 100): Promise<(Row & { deliveries: Row[] })[]> {
  return read(app, limit);
}

/** Recent messages sent to or received from one user. */
export function userMessages(app: App, usrId: number, limit?: number): Promise<(Row & { deliveries: Row[] })[]> {
  return read(app, limit, usrId);
}

async function read(app: App, limit?: number, usrId?: number): Promise<(Row & { deliveries: Row[] })[]> {
  const where = usrId == null ? sql`` : sql`WHERE EXISTS (
    SELECT 1 FROM message_delivery selected
    WHERE selected.message_id = m.id AND selected.usr_id = ${usrId}
  )`;
  const delivery = usrId == null ? sql`` : sql`AND d.usr_id = ${usrId}`;
  const take = limit == null ? sql`` : sql`LIMIT ${limit}`;
  const rows = await app.db.query`
    SELECT m.id, m.channel, m.direction, m.grp_id, m.log_id, m.data, m.time,
      (SELECT COUNT(*) FROM message_delivery md WHERE md.message_id = m.id) AS recipient_count,
      g.name AS grp_name, d.id AS delivery_id, d.usr_id, d.address, d.time AS delivery_time,
      d.error, u.email
    FROM (SELECT m.* FROM message m ${where} ORDER BY m.time DESC, m.id DESC ${take}) m
    LEFT JOIN grp g ON g.id = m.grp_id
    LEFT JOIN message_delivery d ON d.message_id = m.id ${delivery}
    LEFT JOIN usr u ON u.id = d.usr_id
    ORDER BY m.time DESC, m.id DESC, d.id`;
  const byId = new Map<number, Row & { deliveries: Row[] }>();
  for (const row of rows) {
    const id = Number(row.id);
    const message = byId.getOrInsertComputed(id, () => ({
      id: row.id,
      channel: row.channel,
      direction: row.direction,
      grp_id: row.grp_id,
      grp_name: row.grp_name,
      log_id: row.log_id,
      data: row.data,
      time: row.time,
      recipient_count: row.recipient_count,
      deliveries: [],
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
  return [...byId.values()];
}
