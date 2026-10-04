import { ApiError } from "@qino/qino";

import { capture, record, series } from "./mod.ts";

import type { App } from "@qino/qino";
import type { Jobs } from "@qino/qino/cron";
import type { Entity } from "@qino/qino/home";
import type { Read } from "@qino/qino/home.history";

export { api } from "./api.ts";
export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("home:change", ({ provider, id, entity, previous }) => record(app, provider, entity ?? {
    id, name: previous?.name ?? id, state: null, attributes: previous?.attributes ?? {}, available: false,
  }).catch((error) => console.error("home.record:", error)), { signal });
  app.on("home.history:providers", async (request) => { request.providers.push(...(await series(app)).map((row) => row.provider)); }, { signal });
  app.on("home.history:read", (request) => read(app, request), { signal });
}

export const cron = { capture: { every: 60, run: (app: App) => capture(app) } } satisfies Jobs;

/** Query one local series without requiring its provider to be running. */
async function read(app: App, request: Read): Promise<void> {
  if (request.data !== undefined || request.source === "provider") return;
  const { provider, id, start, end, limit } = request;
  if (!await app.db.one`SELECT entity FROM home_series WHERE provider = ${provider} AND entity = ${id}`) return;
  const rows = await app.db.query<{ time: number; data: string }>`SELECT time, data FROM home_sample
    WHERE provider = ${provider} AND entity = ${id} AND time >= ${start} AND time < ${end}
    ORDER BY time LIMIT ${limit + 1}`;
  if (rows.length > limit) throw new ApiError(413, "History exceeds the sample limit; narrow the period or increase limit");
  request.data = rows.map((row) => ({ ...JSON.parse(row.data) as Entity, updated: new Date(Number(row.time)).toISOString() }));
}

