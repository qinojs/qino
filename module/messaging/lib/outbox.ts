import { errMsg, unixTime } from "@qino/qino";

import { channel } from "../mod.ts";
import { dispatch } from "./dispatch.ts";

import type { App, Row } from "@qino/qino";

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

/** Deliveries that are owed now, oldest first, each carrying the message it belongs to. */
export function due(app: App, limit = 100): Promise<Row[]> {
  return app.db.query`
    SELECT d.id, d.message_id, m.channel FROM message_delivery d
    JOIN message m ON m.id = d.message_id
    WHERE d.sent IS NULL AND d.due IS NOT NULL AND d.due <= ${unixTime()}
    ORDER BY d.due LIMIT ${limit}`;
}

/** Send what is owed, one batch per message: a connection, a rate limit and one render pass are
 *  worth sharing, and that is what a batch is. */
export async function run(app: App, limit = 100): Promise<number> {
  const batches = Map.groupBy(await due(app, limit), (row) => `${row.channel}\0${row.message_id}`);
  let sent = 0;
  for (const rows of batches.values()) {
    const c = channel(app, String(rows[0].channel));
    if (c) sent += await dispatch(app, c, rows.map((row) => Number(row.id))).catch(() => 0);
  }
  return sent;
}
