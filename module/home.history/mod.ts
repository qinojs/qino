import { ApiError, NotFoundError } from "@qino/qino";
import { providers as homeProviders } from "@qino/qino/home";

import type { App } from "@qino/qino";
import type { Entity, Provider } from "@qino/qino/home";

function registered(app: App): Provider[] {
  homeProviders(app); // Check name uniqueness before selecting an optional capability.
  return app.modules.linked().flatMap((mod) => mod.plugin.homeProvider ? [mod.plugin.homeProvider as Provider] : []);
}

export async function providers(app: App): Promise<string[]> {
  const request = { providers: registered(app).filter((p) => p.history).map((p) => p.name) };
  await app.fire("home.history:providers", request);
  return [...new Set(request.providers)];
}

/** Read stored observations. Missing samples are neither zero-filled nor interpolated. */
export async function history(app: App, provider: string, entity: string, period: { start: string; end: string; source?: "auto" | "local" | "provider"; limit?: number }) {
  const start = timestamp(period.start), end = timestamp(period.end);
  if (start >= end) throw new ApiError(400, "History start must precede end");
  const source = period.source ?? "auto", limit = period.limit ?? 100_000;
  if (!["auto", "local", "provider"].includes(source)) throw new ApiError(400, "Unknown history source");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit >= Number.MAX_SAFE_INTEGER) throw new ApiError(400, "History limit must be a positive integer");
  const request: Read = { provider, id: entity, start, end, source, limit };
  if (source !== "provider") await app.fire("home.history:read", request);
  if (request.data !== undefined) return request.data;
  if (source === "local") throw new NotFoundError("Local home history is not available for this entity");
  const selected = registered(app).find((p) => p.name === provider);
  if (!selected) throw new NotFoundError(`Home provider is not linked: ${provider}`);
  if (!selected.history) throw new ApiError(501, `Home provider does not support history: ${provider}`);
  const data = await selected.history(app, entity, { start: new Date(start).toISOString(), end: new Date(end).toISOString() });
  if (data.length > limit) throw new ApiError(413, "History exceeds the sample limit; narrow the period or increase limit");
  return data;
}

/** A local archive can answer before a live provider is consulted, including an empty result. */
export type Read = { provider: string; id: string; start: number; end: number; source: "auto" | "local" | "provider"; limit: number; data?: Entity[] };

function timestamp(value: string): number {
  const time = Date.parse(value);
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(time))
    throw new ApiError(400, "History timestamps must include a time and timezone");
  return time;
}
