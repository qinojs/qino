// Public API of uncdn. The qino plugin lives in ./plugin.ts.

import type { App } from "../core/mod.ts";
import { MAX_ASSET_BYTES, uncdnInstances } from "./internal.ts";

/** The app's uncdn state; `origins` = CSP-declared, proxyable by anyone. Throws when uncdn is not loaded. */
export function uncdn(app: App): { origins: Set<string> } {
  const state = uncdnInstances.get(app);
  if (!state) throw new Error('module "uncdn" is not loaded');
  return state;
}

const DEFAULT_FETCH_POLICY = "superuser";
export const DEFAULT_MAX_CACHE_BYTES = 50 * 1024 * 1024;

export function cacheByteLimit(value: unknown): number {
  return Math.max(Number(value) || DEFAULT_MAX_CACHE_BYTES, MAX_ASSET_BYTES);
}

export function fetchPolicy(value: unknown): "superuser" | "all" | "none" {
  return value === "all" || value === "none" ? value : DEFAULT_FETCH_POLICY;
}
