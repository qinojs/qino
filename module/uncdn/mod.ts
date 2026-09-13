// Public API of uncdn. The qino plugin lives in ./plugin.ts.
import type { App } from "@qino/qino";

/** Cap per proxied asset, and the floor for the total cache limit. */
export const MAX_ASSET_BYTES = 1024 * 1024;
export const DEFAULT_MAX_CACHE_BYTES = 50 * 1024 * 1024;

const states = new WeakMap<App, { origins: Set<string> }>();

/** The app's uncdn state; `origins` = CSP-declared, proxyable by anyone. Empty until pages declare sources. */
export function uncdn(app: App): { origins: Set<string> } {
  return states.getOrInsertComputed(app, () => ({ origins: new Set() }));
}

export function cacheByteLimit(value: unknown): number {
  return Math.max(Number(value) || DEFAULT_MAX_CACHE_BYTES, MAX_ASSET_BYTES);
}
