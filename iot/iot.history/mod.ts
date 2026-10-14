import { ApiError, NotFoundError } from "@qino/qino";
import { active, datapoint, value } from "@qino/qino/home";

import type { App } from "@qino/qino";
import type { Datapoint } from "@qino/qino/home";

export type Sample = { time: number; value: number | null; min?: number; max?: number; count?: number; gap?: boolean };
export type Source = "auto" | "local" | "provider";
type Options = { width?: number; consumption?: boolean; maxGap?: number };
export type Period = { start: string; end: string; source?: Source; limit?: number } & Options;
export type Read = { datapoint: number; start: number; end: number; source: Source; limit: number; data?: Sample[] } & Options;

/** Read typed observations; point metadata is returned once, not copied into every sample. */
export async function history(app: App, id: number, period: Period): Promise<{ datapoint: Datapoint; samples: Sample[] }> {
  const start = timestamp(period.start), end = timestamp(period.end), point = await datapoint(app, id);
  if (start >= end) throw new ApiError(400, "History start must precede end");
  const source = period.source ?? "auto", limit = period.limit ?? 100_000;
  if (!["auto", "local", "provider"].includes(source)) throw new ApiError(400, "Unknown history source");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit >= Number.MAX_SAFE_INTEGER)
    throw new ApiError(400, "History limit must be a positive integer");
  const { width, consumption, maxGap: gapSeconds } = period;
  if (width !== undefined && (!Number.isInteger(width) || width < 1 || width > 10_000 || width > limit))
    throw new ApiError(400, "Chart width must be an integer between 1 and 10000 within the sample limit");
  if (gapSeconds !== undefined && (!Number.isFinite(gapSeconds) || gapSeconds < 0))
    throw new ApiError(400, "Maximum gap must be non-negative seconds");
  if (consumption && point.type !== "number") throw new ApiError(400, "Consumption requires a numeric counter datapoint");
  const request: Read = { datapoint: id, start, end, source, limit, width, consumption, maxGap: gapSeconds };
  if (source !== "provider") await app.fire("home.history:read", request);
  if (request.data !== undefined) return { datapoint: point, samples: request.data };
  if (source === "local") throw new NotFoundError("Local home history is not linked");
  const adapter = await active(app, point.provider);
  if (!adapter.history) throw new ApiError(501, "Home adapter does not support upstream history");
  const range = { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
  const observations = await adapter.history(app, point.provider, point.entity, range);
  if (observations.length > limit) throw new ApiError(413, "Upstream history exceeds the sample limit; narrow the period");
  const samples = observations.map((entity) => ({ time: Date.parse(entity.updated ?? ""), value: value(point, entity) }))
    .filter((sample) => Number.isFinite(sample.time) && sample.time >= start && sample.time < end)
    .sort((a, b) => a.time - b.time);
  const maxGap = gapSeconds === undefined ? point.interval * 2000 : gapSeconds * 1000;
  let previous: Sample | undefined;
  const measured = samples.map((sample) => {
    const gap = sample.value === null || !previous || previous.value === null || sample.time <= previous.time ||
      Boolean(maxGap && sample.time - previous.time > maxGap) || Boolean(consumption && sample.value < previous.value);
    const value = consumption ? gap ? null : sample.value! - previous!.value! : sample.value;
    previous = sample;
    return { time: sample.time, value, ...(consumption || maxGap ? { gap } : {}) };
  });
  if (!width) return { datapoint: point, samples: measured };
  const step = Math.ceil((end - start) / width), buckets = new Map<number, Sample[]>();
  for (const sample of measured) {
    const time = start + Math.floor((sample.time - start) / step) * step;
    buckets.getOrInsert(time, []).push(sample);
  }
  return { datapoint: point, samples: [...buckets].map(([time, samples]) => {
    const numbers = samples.flatMap((sample) => sample.value === null ? [] : [sample.value]);
    const sum = numbers.reduce((sum, value) => sum + value, 0);
    const mean = numbers.length ? sum / numbers.length : null;
    const value = consumption ? numbers.length ? sum : null : point.type === "state" ? samples.at(-1)!.value : mean;
    return { time, value, count: numbers.length, gap: samples.some((sample) => sample.gap || sample.value === null),
      ...(numbers.length ? { min: Math.min(...numbers), max: Math.max(...numbers) } : {}) };
  }) };
}

function timestamp(value: string) {
  const time = Date.parse(value);
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(time))
    throw new ApiError(400, "History timestamps must include a time and timezone");
  return time;
}
