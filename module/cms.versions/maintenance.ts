
// History cleanup — deliberately outside the lib/ versioning core.
//
// The bucket width grows with the entry's age: fine resolution for fresh edits, coarser for old
// ones. Per row only the newest entry of each bucket is kept. Widths are powers of two of UNIT_SEC,
// aligned to the epoch, so buckets are stable across runs.
//
// DENSITY = snapshots kept per doubling of age. With UNIT=1min, KEEP_RECENT=1h, DENSITY=24:
//   ~1h old → 1/2min,  ~1d old → 1/30min,  ~1week → 1/4h,  ~1year → 1/11days.
// Entries are full snapshots, so deleting some is safe: views use the previous entry, and every
// live row keeps at least one.
import { sql, unixTime } from "@qino/qino";

import { getVersTable, versedTables } from "./lib/Vers.ts";

import type { Db, Sql } from "@qino/qino";

const DENSITY = 24;           // ~snapshots kept per age doubling (higher = keep more)
const KEEP_RECENT_SEC = 3600; // <1h untouched (still in the active editing window)
const UNIT_SEC = 60;          // finest bucket granularity (1 minute)

/** Thin out old history entries. Returns the affected count; dryRun only counts. */
export async function thinHistory(db: Db, dryRun = false): Promise<number> {
  const now = unixTime();
  const widths = Array.from({ length: Math.ceil(Math.log2(now / (DENSITY * UNIT_SEC))) + 1 }, (_, i) => UNIT_SEC * 2 ** i);
  // bucket width = UNIT × 2^k ≈ age / DENSITY, at least UNIT, aligned to the epoch.
  // integers only: Postgres has no `%` for the double POWER() returns
  const bucket = (col: Sql) => {
    const age = sql`${now} - ${col}`;
    const n = (v: number) => sql.raw(String(v)); // own numbers as literals, not untyped parameters
    const width = sql`CASE ${sql.join(widths.slice(1).map((w, i) => sql`WHEN ${age} < ${n(DENSITY * w)} THEN ${n(widths[i])}`), " ")} ELSE ${n(widths.at(-1)!)} END`;
    return sql`(${col} - (${col} % (${width})))`;
  };

  let count = 0;
  for (const t of Object.keys(versedTables(db))) {
    const versTable = getVersTable(db, t);
    if (!versTable) continue;
    const pks = (await db.columns(t)).filter((c) => c.Key === "PRI").map((c) => c.Field);
    const ids = [...pks, "_vers_space", "_vers_log"];
    const cols = sql.join(ids.map((f) => sql`m.${sql.id(f)}`));
    const join = sql.join(pks.map((f) => sql`mm.${sql.id(f)} = m.${sql.id(f)}`), " AND ");
    // m is deletable if a newer entry mm of the same row falls into the same bucket
    const body = sql`FROM ${sql.id(versTable)} m
      JOIN log l ON l.id = m._vers_log
      JOIN ${sql.id(versTable)} mm ON mm._vers_space = m._vers_space AND ${join} AND mm._vers_log > m._vers_log
      JOIN log ll ON ll.id = mm._vers_log
      WHERE l.time < ${now - KEEP_RECENT_SEC} AND ${bucket(sql`l.time`)} = ${bucket(sql`ll.time`)}`;
    if (dryRun) {
      count += Number(await db.one`SELECT COUNT(*) FROM (SELECT DISTINCT ${cols} ${body}) doomed`);
    } else if (db.dialect === "mysql") {
      count += Number((await db.exec`DELETE m ${body}`).affectedRows ?? 0);
    } else {
      count += Number((await db.exec`DELETE FROM ${sql.id(versTable)} WHERE (${sql.join(ids.map(sql.id))}) IN (SELECT ${cols} ${body})`).affectedRows ?? 0);
    }
  }
  return count;
}
