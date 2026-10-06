import { ApiError, sql } from "@qino/qino";
import { datapoint, datapoints, entities, value } from "@qino/qino/home";

import { record } from "./mod.ts";
import { table, write } from "./lib/write.ts";

import type { App } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";
import type { Datapoint, Entity } from "@qino/qino/home";
import type { Read } from "@qino/qino/home.history";

export { api } from "./api.ts";
export { default as dbSchema } from "./dbschema.json" with { type: "json" };

const key = (provider: number, entity: string) => `${provider} ${entity}`;
const updated = (entity: Entity | null) => entity?.updated === undefined ? Date.now() : Date.parse(entity.updated);

export async function init(app: App, { signal }: { signal: AbortSignal }): Promise<void> {
  let recorded = new Map<string, Datapoint[]>();
  const load = async () => {
    recorded = new Map();
    for (const point of await datapoints(app)) {
      const at = key(point.provider, point.entity);
      if (point.record) recorded.getOrInsert(at, []).push(point);
    }
  };
  const capture = (point: Datapoint, entity: Entity | null, time: number, reported = false) => {
    if (signal.aborted) return;
    return write(app, point, value(point, entity), time, { reported })
      .catch((error) => console.error("home.record:", error));
  };
  // Adapters that connected before this listener existed: take one current observation.
  const snapshot = (points: Datapoint[]) => {
    for (const provider of new Set(points.map((point) => point.provider))) {
      entities(app, provider).then((current) => {
        for (const point of points.filter((point) => point.provider === provider)) {
          const entity = current.find((entity) => entity.id === point.entity) ?? null;
          capture(point, entity, updated(entity));
        }
      }).catch((error) => console.error("home.record:", error));
    }
  };
  await load();
  app.on("home:observe", async ({ provider, id, entity, time }) => {
    for (const point of recorded.get(key(provider, id)) ?? []) await capture(point, entity, time);
  }, { signal });
  // A change report follows its observation at the same time: the row is replaced, not repeated.
  app.on("home:change", async ({ provider, id, entity }) => {
    const time = updated(entity);
    for (const point of recorded.get(key(provider, id)) ?? []) await capture(point, entity, time, true);
  }, { signal });
  app.on("home:datapoint", async ({ id }) => {
    const known = [...recorded.values()].flat().some((point) => point.id === id);
    await load();
    const point = [...recorded.values()].flat().find((point) => point.id === id);
    if (point && !known) snapshot([point]);
  }, { signal });
  app.on("home.history:read", (request) => read(app, request), { signal });
  snapshot([...recorded.values()].flat());
}

/** Expected intervals detect stale streams with one null gap; cached states are never copied. */
export const cron = { stale: { every: 60, run: async (app: App) => {
  const interval = sql.id("interval");
  const ids = await app.db.col<number>`SELECT id FROM home_datapoint WHERE record = ${true} AND ${interval} > 0
    AND value IS NOT NULL AND time < ${Date.now()} - ${interval} * 2000`;
  for (const id of ids) await record(app, Number(id), null).catch((error) => console.error("home.record:", error));
} } } satisfies Jobs;

/** Query one local datapoint without requiring its provider to be running. */
async function read(app: App, request: Read): Promise<void> {
  if (request.data !== undefined || request.source === "provider") return;
  const point = await datapoint(app, request.datapoint);
  const { start, end, limit, width, consumption } = request;
  const maxGap = request.maxGap === undefined ? point.interval * 2000 : request.maxGap * 1000;
  const from = sql`FROM ${sql.id(table(point))} WHERE datapoint = ${point.id}`;
  if (request.source === "auto" && !point.record && !await app.db.one`SELECT time ${from} LIMIT 1`) return;
  // The sample preceding the period supplies the first difference and gap.
  const range = sql`SELECT time, value ${from} AND time >= ${start} AND time < ${end}`;
  const input = sql`${range} UNION ALL
    SELECT time, value FROM (SELECT time, value ${from} AND time < ${start} ORDER BY time DESC LIMIT 1) previous`;
  const gap = sql`CASE WHEN value IS NULL OR previous_value IS NULL
    OR (${maxGap} > 0 AND time - previous_time > ${maxGap}) ${consumption ? sql`OR value < previous_value` : sql``}
    THEN 1 ELSE 0 END`;
  const measured = consumption ? sql`CASE WHEN ${gap} = 0 THEN value - previous_value ELSE NULL END` : sql`value`;
  const step = width ? Math.ceil((end - start) / width) : 1;
  const bucket = sql`time - (time - ${start}) % ${step}`;
  const ordered = sql`WITH observations AS (${input}), ordered AS (
      SELECT time, value, LAG(time) OVER (ORDER BY time) previous_time, LAG(value) OVER (ORDER BY time) previous_value
      FROM observations
    )`;
  const aggregate = consumption ? sql`SUM(value)`
    : point.type === "state" ? sql`MAX(CASE WHEN position = 1 THEN value ELSE NULL END)` : sql`AVG(value)`;
  const query = width ? sql`${ordered}, measured AS (
      SELECT time, ${measured} value, ${gap} gap FROM ordered WHERE time >= ${start}
    ), bucketed AS (
      SELECT ${bucket} bucket, time, value, gap, ROW_NUMBER() OVER (PARTITION BY ${bucket} ORDER BY time DESC) position
      FROM measured
    ) SELECT bucket time, ${aggregate} value, MIN(value) min, MAX(value) max, COUNT(value) count, MAX(gap) gap
      FROM bucketed GROUP BY bucket ORDER BY bucket LIMIT ${limit + 1}`
    : consumption || maxGap
    ? sql`${ordered} SELECT time, ${measured} value, ${gap} gap FROM ordered WHERE time >= ${start}
      ORDER BY time LIMIT ${limit + 1}`
    : sql`${range} ORDER BY time LIMIT ${limit + 1}`;
  type Row = { time: number; value: number | null; min?: number | null; max?: number | null; count?: number; gap?: number };
  const rows = await app.db.query<Row>` ${query}`;
  if (rows.length > limit)
    throw new ApiError(413, "History exceeds the sample limit; narrow the period or request bounded chart data");
  request.data = rows.map((row) => ({
    time: Number(row.time), value: row.value === null ? null : Number(row.value),
    ...(row.gap === undefined ? {} : { gap: Boolean(row.gap) }),
    ...(width ? { count: Number(row.count) } : {}),
    ...(width && row.min !== null ? { min: Number(row.min), max: Number(row.max) } : {}),
  }));
}
