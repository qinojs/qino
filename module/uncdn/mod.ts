// Public API of uncdn. The qino plugin lives in ./plugin.ts.

declare module "../core/lib/App.ts" {
  interface App { uncdn: { origins: Set<string> }; } // origins.* = CSP-declared, proxyable by anyone
}

export const CACHE_SUBDIR = "cache/uncdn/";
export const DEFAULT_FETCH_POLICY = "superuser";
export const DEFAULT_MAX_CACHE_BYTES = 50 * 1024 * 1024;

const MAX_ASSET_BYTES = 1024 * 1024;

export function cacheByteLimit(value: unknown): number {
  return Math.max(Number(value) || DEFAULT_MAX_CACHE_BYTES, MAX_ASSET_BYTES);
}

export function fetchPolicy(value: unknown): "superuser" | "all" | "none" {
  return value === "all" || value === "none" ? value : DEFAULT_FETCH_POLICY;
}
