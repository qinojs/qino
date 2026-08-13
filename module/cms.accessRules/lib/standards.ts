import type { App } from "@qino/qino";

// module → cms_access rules per app, cached (hot path: every node render checks it)
const stdCache = new WeakMap<object, Promise<Map<string, number>>>();

export function standards(app: App): Promise<Map<string, number>> {
  let p = stdCache.get(app);
  if (!p) {
    p = app.db.query`SELECT name, cms_access FROM module WHERE cms_access IS NOT NULL`
      .then((rows) => new Map(rows.map((r) => [String(r.name), Number(r.cms_access)])));
    p.catch(() => stdCache.delete(app)); // don't cache failures
    stdCache.set(app, p);
  }
  return p;
}

/** Call after writing module.cms_access. */
export function invalidateStandards(app: App): void {
  stdCache.delete(app);
}
