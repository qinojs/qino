import { ApiError, sql } from "@qino/qino";

import type { App } from "@qino/qino";
import type { Datapoint } from "@qino/qino/home";

/**
 * Unchanged values are skipped until the expected interval has passed, so steady streams cost a row
 * per interval instead of one per report; repeated nulls are skipped entirely. Both statements read
 * the same, still unchanged cache row and re-check the recording flag, so a selection stopped
 * concurrently never writes.
 */
export async function write(app: App, point: Datapoint, value: number | null, time: number): Promise<void> {
  if (!Number.isSafeInteger(time) || !Number.isFinite(new Date(time).getTime()))
    throw new ApiError(400, "Invalid measurement time");
  const state = point.type === "state" && value !== null && (!Number.isInteger(value) || value < -128 || value > 127);
  if (value !== null && !Number.isFinite(value) || state)
    throw new ApiError(400, "Value does not match the datapoint datatype");
  const interval = sql.id("interval");
  // One null marks a gap; nothing marks the time before the first value. Late values are never skipped.
  const same = value === null ? sql`value IS NULL AND (time IS NULL OR ${time} >= time)`
    : sql`value IS NOT NULL AND value = ${value} AND ${time} >= time
      AND (${interval} = 0 OR ${time} - time < ${interval} * 1000)`;
  const fresh = sql`id = ${point.id} AND record = ${true} AND NOT (${same})`;
  const conflict = app.db.dialect === "mysql"
    ? sql`ON DUPLICATE KEY UPDATE value = ${value}`
    : sql`ON CONFLICT (datapoint, time) DO UPDATE SET value = ${value}`;
  await app.db.unit(async () => {
    await app.db.query`INSERT INTO ${sql.id(table(point))} (datapoint, time, value)
      SELECT id, ${time}, ${value} FROM home_datapoint WHERE ${fresh} ${conflict}`;
    await app.db.query`UPDATE home_datapoint SET time = ${time}, value = ${value}
      WHERE ${fresh} AND (time IS NULL OR time <= ${time})`;
  });
}

export const table = (point: Datapoint): string => point.type === "number" ? "home_number" : "home_state";
