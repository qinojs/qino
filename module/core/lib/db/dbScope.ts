// Per-request db read scope.
//
// While a scope is active (ctx.state.dbScope = { tables, cache: {} }):
//  - table reads built with tableRef() resolve to alternative tables
//    (e.g. versioned views — see cms.versions),
//  - shared app-level caches accessed via scopeCache() are replaced by a
//    request-local cache, so scoped data never pollutes them.
// Delete scope.tables to stop the routing while keeping the request cache.

import { requestStorage } from "../ctx/RequestContext.ts";

export interface DbScope {
  tables?: Record<string, string>; // table name → replacement
  cache: Record<string, unknown>;  // request-local cache slots, keyed per consumer
}

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
