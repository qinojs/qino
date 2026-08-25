import { errMsg, unixTime } from "@qino/qino";

import { channels } from "../mod.ts";

import type { App, Row } from "@qino/qino";
import type { Msg } from "../mod.ts";

/**
 * A failure that is ours, not the address's: no provider configured, no connection, refused
 * credentials, a rate limit. It belongs in the journal, never on the contact — the address may be
 * perfectly good — and it is the only kind worth trying again.
 */
export class ChannelError extends Error {}

const ATTEMPTS = 3;
/** A minute, then four — long enough for a hiccup, short enough to still be today. */
const backoff = (attempts: number) => 60 * 4 ** (attempts - 1);

/**
 * How one attempt went. Ours to blame and attempts left: back in the queue. Anything else is
 * final — it went out, or the address refused it.
 */
export async function delivered(app: App, id: number, error?: unknown): Promise<void> {
  const table = app.db.table("message_delivery");
  const message = error == null ? null : errMsg(error);
  if (!(error instanceof ChannelError)) return void await table.update(id, { error: message, sent: unixTime(), due: null });
  const attempts = Number(await app.db.one`SELECT attempts FROM message_delivery WHERE id = ${id}` ?? 0) + 1;
  await table.update(id, { error: message, attempts, due: attempts < ATTEMPTS ? unixTime() + backoff(attempts) : null });
}

/** A new delivery's timing: an address that will never be tried is finished, the rest is owed now. */
export const owed = (addressError: string | undefined, time: number): { error: string; sent: number } | { due: number } =>
  addressError ? { error: addressError, sent: time } : { due: time };

/** Deliveries that are owed now, oldest first, each carrying its message's channel and group. */
export function due(app: App, limit = 100): Promise<Row[]> {
  return app.db.query`
    SELECT d.*, m.channel, m.grp_id FROM message_delivery d
    JOIN message m ON m.id = d.message_id
    WHERE d.sent IS NULL AND d.due IS NOT NULL AND d.due <= ${unixTime()}
    ORDER BY d.due LIMIT ${limit}`;
}

/** Send what is owed. Channels without `deliver` cannot be retried and are left alone. */
export async function run(app: App, limit = 100): Promise<number> {
  let sent = 0;
  for (const row of await due(app, limit)) {
    const channel = channels(app).find((c) => c.name === row.channel);
    if (!channel?.deliver) continue;
    // rendered again, not stored: a held message says "today" on the day it goes out
    const m = await app.db.row`SELECT title, text, format, template FROM message WHERE id = ${row.message_id}`;
    if (!m) continue;
    try {
      await channel.deliver(app, row, {
        text: String(m.text ?? ""),
        title: m.title == null ? undefined : String(m.title),
        format: m.format as Msg["format"],
        template: m.template as Msg["template"],
      });
      sent++;
    } catch (e) {
      await delivered(app, Number(row.id), e);
    }
  }
  return sent;
}
