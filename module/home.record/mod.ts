import { ApiError, sql } from "@qino/qino";
import { datapoint } from "@qino/qino/home";

import type { App } from "@qino/qino";

/** Store a typed observation, retaining source time; repeated timestamps replace the prior value. */
export async function record(app: App, id: number, value: number | null, time = Date.now()): Promise<void> {
  const point = await datapoint(app, id);
  if (!Number.isSafeInteger(time) || !Number.isFinite(new Date(time).getTime())) throw new ApiError(400, "Invalid measurement time");
  if (value !== null && (!Number.isFinite(value) || point.type === "state" && (!Number.isInteger(value) || value < -128 || value > 127)))
    throw new ApiError(400, "Value does not match the datapoint datatype");
  const table = point.type === "number" ? "home_number" : "home_state";
  await app.db.unit(async () => {
    const conflict = app.db.dialect === "mysql"
      ? sql`ON DUPLICATE KEY UPDATE value = ${value}`
      : sql`ON CONFLICT (datapoint, time) DO UPDATE SET value = ${value}`;
    await app.db.query`INSERT INTO ${sql.id(table)} (datapoint, time, value)
      SELECT id, ${time}, ${value} FROM home_datapoint WHERE id = ${id} AND record = ${true} ${conflict}`;
    await app.db.query`UPDATE home_datapoint SET time = ${time}, value = ${value}
      WHERE id = ${id} AND record = ${true} AND (time IS NULL OR time <= ${time})`;
  });
}
