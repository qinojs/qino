import { ApiError, sql } from "@qino/qino";
import { datapoint, datapoints, entities, value } from "@qino/qino/home";

import { record } from "./mod.ts";

import type { App } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";
import type { Entity } from "@qino/qino/home";
import type { Read } from "@qino/qino/home.history";

export { api } from "./api.ts";
export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export async function init(app: App, { signal }: { signal: AbortSignal }): Promise<void> {
  let points = await datapoints(app);
  const capture = async (id: number, entity: Entity | null, observed?: number) => {
    const point = points.find((point) => point.id === id);
    if (!point?.record || signal.aborted) return;
    const time = observed ?? (entity?.updated === undefined ? Date.now() : Date.parse(entity.updated));
    await record(app, id, value(point, entity), time);
  };
  app.on("home:observe", async ({ provider, id, entity, time }) => {
    for (const point of points.filter((point) => point.provider === provider && point.entity === id && point.record))
      await capture(point.id, entity, time).catch((error) => console.error("home.record:", error));
  }, { signal });
  app.on("home:datapoint", async ({ id }) => {
    const previous = points.find((point) => point.id === id)?.record;
    points = await datapoints(app);
    const point = points.find((point) => point.id === id);
    if (!point?.record || previous) return;
    const current = await entities(app, point.provider).catch(() => []);
    await capture(id, current.find((entity) => entity.id === point.entity) ?? null, Date.now());
  }, { signal });
  app.on("home.history:read", (request) => read(app, request), { signal });
}

/** Expected intervals detect stale streams; cached states are never copied as new measurements. */
export const cron = { stale: { every: 60, run: async (app: App) => {
  for (const point of await datapoints(app)) {
    if (point.record && point.interval && point.time !== null && point.value !== null && Date.now() - point.time > point.interval * 2000)
      await record(app, point.id, null);
  }
} } } satisfies Jobs;

/** Query one local datapoint without requiring its provider to be running. */
async function read(app: App, request: Read): Promise<void> {
  if (request.data !== undefined || request.source === "provider") return;
  const point = await datapoint(app, request.datapoint);
  const { start, end, limit, width, consumption } = request;
  const maxGap = request.maxGap === undefined ? point.interval * 2000 : request.maxGap * 1000;
  const table = point.type === "number" ? "home_number" : "home_state";
  if (request.source === "auto" && !point.record && !await app.db.one`SELECT time FROM ${sql.id(table)} WHERE datapoint = ${point.id} LIMIT 1`) return;
  const input = sql`SELECT time, value FROM ${sql.id(table)} WHERE datapoint = ${point.id} AND time >= ${start} AND time < ${end}
    UNION ALL SELECT time, value FROM (SELECT time, value FROM ${sql.id(table)} WHERE datapoint = ${point.id} AND time < ${start} ORDER BY time DESC LIMIT 1) previous`;
  const gap = sql`CASE WHEN value IS NULL OR previous_value IS NULL OR (${maxGap} > 0 AND time - previous_time > ${maxGap})
    ${consumption ? sql`OR value < previous_value` : sql``} THEN 1 ELSE 0 END`;
  const measured = consumption ? sql`CASE WHEN ${gap} = 0 THEN value - previous_value ELSE NULL END` : sql`value`;
  const step = width ? Math.ceil((end - start) / width) : 1;
  const bucket = sql`time - (time - ${start}) % ${step}`;
  const query = width ? sql`WITH observations AS (${input}), ordered AS (
      SELECT time, value, LAG(time) OVER (ORDER BY time) previous_time, LAG(value) OVER (ORDER BY time) previous_value FROM observations
    ), measured AS (SELECT time, ${measured} value, ${gap} gap FROM ordered WHERE time >= ${start}), bucketed AS (
      SELECT ${bucket} bucket, time, value, gap, ROW_NUMBER() OVER (PARTITION BY ${bucket} ORDER BY time DESC) position FROM measured
    ) SELECT bucket time,
      ${consumption ? sql`SUM(value)` : point.type === "state" ? sql`MAX(CASE WHEN position = 1 THEN value ELSE NULL END)` : sql`AVG(value)`} value,
      MIN(value) min, MAX(value) max, COUNT(value) count, MAX(gap) gap
      FROM bucketed GROUP BY bucket ORDER BY bucket LIMIT ${limit + 1}`
    : consumption || maxGap ? sql`WITH observations AS (${input}), ordered AS (
      SELECT time, value, LAG(time) OVER (ORDER BY time) previous_time, LAG(value) OVER (ORDER BY time) previous_value FROM observations
    ) SELECT time, ${measured} value, ${gap} gap FROM ordered WHERE time >= ${start} ORDER BY time LIMIT ${limit + 1}`
    : sql`SELECT time, value FROM ${sql.id(table)} WHERE datapoint = ${point.id} AND time >= ${start} AND time < ${end} ORDER BY time LIMIT ${limit + 1}`;
  const rows = await app.db.query<{ time: number; value: number | null; min?: number | null; max?: number | null; count?: number; gap?: number }>` ${query}`;
  if (rows.length > limit) throw new ApiError(413, "History exceeds the sample limit; narrow the period or request bounded chart data");
  request.data = rows.map((row) => ({
    time: Number(row.time), value: row.value === null ? null : Number(row.value),
    ...(row.gap === undefined ? {} : { gap: Boolean(row.gap) }),
    ...(width ? { count: Number(row.count), ...(row.min === null ? {} : { min: Number(row.min), max: Number(row.max) }) } : {}),
  }));
}
