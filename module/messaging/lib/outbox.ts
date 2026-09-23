import { errMsg, unixTime } from "@qino/qino";

import { channel } from "../mod.ts";
import { dispatch } from "./dispatch.ts";

import type { App, Row } from "@qino/qino";

/**
 * A failure on our side, not the address's: no provider, no connection, wrong credentials, rate
 * limit. Recorded in the journal, never on the contact, and the only kind that is retried.
 */
export class ChannelError extends Error {}

const ATTEMPTS = 3;
/** One minute, then four. */
const backoff = (attempts: number) => 60 * 4 ** (attempts - 1);

/**
 * Store the outcome of an attempt. Our fault and attempts left: queue again. Otherwise final.
 * `ref` is the other side's id.
 */
export async function delivered(app: App, id: number, error?: unknown, ref?: string): Promise<void> {
  const table = app.db.table("message_delivery");
  const message = error == null ? null : errMsg(error);
  if (!(error instanceof ChannelError)) return void await table.update(id, { error: message, ref: ref ?? null, sent: unixTime(), due: null });
  const attempts = Number(await app.db.one`SELECT attempts FROM message_delivery WHERE id = ${id}` ?? 0) + 1;
  await table.update(id, { error: message, attempts, due: attempts < ATTEMPTS ? unixTime() + backoff(attempts) : null });
}

/** Initial state of a new delivery: undeliverable ones are finished, others due now. */
export const owed = (addressError: string | undefined, time: number): { error: string; sent: number } | { due: number } =>
  addressError ? { error: addressError, sent: time } : { due: time };

/** Due deliveries, oldest first, each with its message. */
export function due(app: App, limit = 100): Promise<Row[]> {
  return app.db.query`
    SELECT d.id, d.message_id, m.channel FROM message_delivery d
    JOIN message m ON m.id = d.message_id
    WHERE d.sent IS NULL AND d.due IS NOT NULL AND d.due <= ${unixTime()}
    ORDER BY d.due LIMIT ${limit}`;
}

/** Send due deliveries, one batch per message (shares connection, rate limit and rendering). */
export async function run(app: App, limit = 100): Promise<number> {
  const batches = Map.groupBy(await due(app, limit), (row) => `${row.channel}\0${row.message_id}`);
  let sent = 0;
  for (const rows of batches.values()) {
    const c = channel(app, String(rows[0].channel));
    if (c) sent += await dispatch(app, c, rows.map((row) => Number(row.id))).catch(() => 0);
  }
  return sent;
}
