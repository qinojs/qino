import { ApiError, NotFoundError } from "@qino/qino";
import { providers as homeProviders } from "@qino/qino/home";

import type { App } from "@qino/qino";
import type { Provider } from "@qino/qino/home";

function registered(app: App): Provider[] {
  homeProviders(app); // Check name uniqueness before selecting an optional capability.
  return app.modules.linked().flatMap((mod) => mod.plugin.homeProvider ? [mod.plugin.homeProvider as Provider] : []);
}

export const providers = (app: App): string[] => registered(app).filter((p) => p.history).map((p) => p.name);

/** Read stored observations. Missing samples are neither zero-filled nor interpolated. */
export function history(app: App, provider: string, entity: string, period: { start: string; end: string }) {
  const start = timestamp(period.start), end = timestamp(period.end);
  if (start >= end) throw new ApiError(400, "History start must precede end");
  const selected = registered(app).find((p) => p.name === provider);
  if (!selected) throw new NotFoundError(`Home provider is not linked: ${provider}`);
  if (!selected.history) throw new ApiError(501, `Home provider does not support history: ${provider}`);
  return selected.history(app, entity, { start: new Date(start).toISOString(), end: new Date(end).toISOString() });
}

function timestamp(value: string): number {
  const time = Date.parse(value);
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(time))
    throw new ApiError(400, "History timestamps must include a time and timezone");
  return time;
}
