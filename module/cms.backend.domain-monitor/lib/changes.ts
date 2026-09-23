import { sql, unixTime } from "@qino/qino";

import { parseResult } from "./monitor.ts";

import type { App } from "@qino/qino";
import type { DomainRow } from "./monitor.ts";

// Fields that change on every check and are ignored: timings, countdowns, log ids, the mail banner
// (contains a clock) and dns_changed from older results.
const IGNORED = new Set(["response_time", "cert_days", "checked", "checked_deep", "dns_changed", "log_id", "log_id_ch", "mail_banner"]);

function flattened(value: unknown, path = "", target = new Map<string, unknown>()): Map<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (IGNORED.has(key)) continue;
      flattened(child, path ? `${path}.${key}` : key, target);
    }
  } else target.set(path, value);
  return target;
}

/** What moved between two check results. A first check compares against nothing and never counts. */
export function diffResults(previous: unknown, current: unknown): { key: string; before: unknown; after: unknown }[] {
  if (!previous) return [];
  const before = flattened(previous);
  const after = flattened(current);
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((key) => JSON.stringify(before.get(key)) !== JSON.stringify(after.get(key)))
    .map((key) => ({ key, before: before.get(key), after: after.get(key) }));
}

/** The last stored measurement, which is what a fresh check is compared against. */
export async function lastResult(app: App, domain: string): Promise<Partial<DomainRow> | undefined> {
  return parseResult(await app.db.one`SELECT result FROM monitor_domain_check WHERE domain = ${domain} ORDER BY id DESC LIMIT 1`);
}

const KEEP = 7 * 24 * 60 * 60; // young checks stay whether they changed anything or not
const PAGE = 500;

// Of a series of equal checks the first stays (it dates the state). Paging by id walks the history
// in time order; only rows behind the cursor are deleted.
/** Drop old checks that recorded no relevant change. Returns how many rows went. */
export async function pruneHistory(
  app: App,
  { before = unixTime() - KEEP, signal }: { before?: number; signal?: AbortSignal } = {},
): Promise<number> {
  let removed = 0;
  for (const domain of await app.db.col<string>`SELECT DISTINCT domain FROM monitor_domain_check`) {
    signal?.throwIfAborted();
    let kept: unknown;
    let cursor = 0;
    for (;;) {
      const page = await app.db.query<{ id: number; checked_at: number; result: string }>`
        SELECT id, checked_at, result FROM monitor_domain_check
        WHERE domain = ${domain} AND id > ${cursor} ORDER BY id LIMIT ${PAGE}`;
      if (!page.length) break;
      cursor = page[page.length - 1].id;
      const stale = [];
      for (const check of page) {
        const result = parseResult(check.result);
        if (kept && check.checked_at < before && !diffResults(kept, result).length) stale.push(check.id);
        else kept = result;
      }
      if (stale.length) await app.db.exec`DELETE FROM monitor_domain_check WHERE ${sql.in("id", stale)}`;
      removed += stale.length;
      if (page.length < PAGE) break;
    }
  }
  return removed;
}
