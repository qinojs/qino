// Per-request db read scope. While active (ctx.state.dbScope = { tables, cache: {} }):
//  - tableRef() resolves to other tables (e.g. versioned views, see cms.versions),
//  - scopeCache() returns a request-local cache instead of the shared one.
// Delete scope.tables to stop redirecting tables but keep the request cache.
import { requestStorage } from "../ctx/Ctx.ts";

export type DbScope = {
  tables?: Record<string, string>; // table name → replacement
  cache: Record<string, unknown>;  // request-local cache slots, keyed per consumer
};

export function dbScope(): DbScope | undefined {
  return requestStorage.getStore()?.state.dbScope;
}

/** Resolve a table name through the active scope (identity without scope). */
export function tableRef(name: string): string {
  return dbScope()?.tables?.[name] ?? name;
}

/** The shared app-level cache, or a request-local one while a scope is active. */
export function scopeCache<T>(shared: T, key: string, init: () => T): T {
  const s = dbScope();
  if (!s) return shared;
  return (s.cache[key] ??= init()) as T;
}
