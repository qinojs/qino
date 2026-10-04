import { ApiError, NotFoundError } from "@qino/qino";
import { adapters, datapoint, provider, value } from "@qino/qino/home";

import type { App } from "@qino/qino";
import type { Datapoint } from "@qino/qino/home";

export type Sample = { time: number; value: number | null; min?: number; max?: number; count?: number; gap?: boolean };
export type Read = { datapoint: number; start: number; end: number; source: "auto" | "local" | "provider"; limit: number; width?: number; consumption?: boolean; maxGap?: number; data?: Sample[] };

/** Read typed observations; point metadata is returned once, not copied into every sample. */
export async function history(app: App, id: number, period: { start: string; end: string; source?: "auto" | "local" | "provider"; limit?: number; width?: number; consumption?: boolean; maxGap?: number }): Promise<{ datapoint: Datapoint; samples: Sample[] }> {
  const start = timestamp(period.start), end = timestamp(period.end), point = await datapoint(app, id);
  if (start >= end) throw new ApiError(400, "History start must precede end");
  const source = period.source ?? "auto", limit = period.limit ?? 100_000;
  if (!["auto", "local", "provider"].includes(source)) throw new ApiError(400, "Unknown history source");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit >= Number.MAX_SAFE_INTEGER) throw new ApiError(400, "History limit must be a positive integer");
  if (period.width !== undefined && (!Number.isInteger(period.width) || period.width < 1 || period.width > 10_000 || period.width > limit))
    throw new ApiError(400, "Chart width must be an integer between 1 and 10000 within the sample limit");
  if (period.maxGap !== undefined && (!Number.isFinite(period.maxGap) || period.maxGap < 0)) throw new ApiError(400, "Maximum gap must be non-negative seconds");
  if (period.consumption && point.type !== "number") throw new ApiError(400, "Consumption requires a numeric counter datapoint");
  const request: Read = { datapoint: id, start, end, source, limit, width: period.width, consumption: period.consumption, maxGap: period.maxGap };
  if (source !== "provider") await app.fire("home.history:read", request);
  if (request.data !== undefined) return { datapoint: point, samples: request.data };
  if (source === "local") throw new NotFoundError("Local home history is not linked");
  const row = await provider(app, point.provider);
  if (!row.enabled) throw new ApiError(503, "Home provider is disabled");
  const adapter = adapters(app).find((adapter) => adapter.name === row.adapter);
  if (!adapter?.history) throw new ApiError(501, "Home adapter does not support upstream history");
  const observations = await adapter.history(app, row.id, point.entity, { start: new Date(start).toISOString(), end: new Date(end).toISOString() });
  if (observations.length > limit) throw new ApiError(413, "Upstream history exceeds the sample limit; narrow the period");
  const samples = observations.map((entity) => ({ time: Date.parse(entity.updated ?? ""), value: value(point, entity) }))
    .filter((sample) => Number.isFinite(sample.time) && sample.time >= start && sample.time < end).sort((a, b) => a.time - b.time);
  const maxGap = period.maxGap === undefined ? point.interval * 2000 : period.maxGap * 1000;
  let previous: Sample | undefined;
  const measured = samples.map((sample) => {
    const gap = sample.value === null || !previous || previous.value === null || sample.time <= previous.time ||
      Boolean(maxGap && sample.time - previous.time > maxGap) || Boolean(period.consumption && sample.value < previous.value!);
    const value = period.consumption ? gap ? null : sample.value! - previous!.value! : sample.value;
    previous = sample;
    return { time: sample.time, value, ...(period.consumption || maxGap ? { gap } : {}) };
  });
  if (!period.width) return { datapoint: point, samples: measured };
  const step = Math.ceil((end - start) / period.width), buckets = new Map<number, Sample[]>();
  for (const sample of measured) {
    const time = start + Math.floor((sample.time - start) / step) * step;
    const bucket = buckets.get(time) ?? [];
    bucket.push(sample); buckets.set(time, bucket);
  }
  return { datapoint: point, samples: [...buckets].map(([time, samples]) => {
    const numbers = samples.flatMap((sample) => sample.value === null ? [] : [sample.value]);
    const sum = numbers.reduce((sum, value) => sum + value, 0);
    const value = period.consumption ? numbers.length ? sum : null : point.type === "state" ? samples.at(-1)!.value : numbers.length ? sum / numbers.length : null;
    return { time, value, count: numbers.length, gap: samples.some((sample) => sample.gap || sample.value === null),
      ...(numbers.length ? { min: Math.min(...numbers), max: Math.max(...numbers) } : {}) };
  }) };
}

function timestamp(value: string): number {
  const time = Date.parse(value);
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(time)) throw new ApiError(400, "History timestamps must include a time and timezone");
  return time;
}
