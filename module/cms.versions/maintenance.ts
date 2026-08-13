
// History maintenance — intentionally outside the lib/ versioning core.
//
// Scale-invariant decay: the bucket width is a fraction of the entry's OWN age,
// so resolution stays fine while edits are fresh (bursts of saves within minutes)
// and coarsens as they age — instead of one fixed unit (a day) for everything.
// Per row only the newest entry of each bucket survives. Width is quantised to
// powers of two of UNIT_SEC so buckets are epoch-anchored and stable across runs.
//
// DENSITY is the single generosity knob: ~that many snapshots are kept per age
// doubling. With UNIT=1min, KEEP_RECENT=1h, DENSITY=24 a row keeps roughly:
//   ~1h old → 1/2min,  ~1d old → 1/30min,  ~1week → 1/4h,  ~1year → 1/11days.
// Entries are self-contained snapshots, so deleting intermediate ones is safe —
// views fall back to the previous surviving entry, and since the newest entry
// per bucket survives, every live row keeps ≥1 entry (baseline invariant).
import { sql, unixTime } from "@qino/qino";

import { versTable, versedTables } from "./lib/Vers.ts";

import type { Db, Sql } from "@qino/qino";

const DENSITY = 24;           // ~snapshots kept per age doubling (higher = keep more)
const KEEP_RECENT_SEC = 3600; // <1h untouched (still in the active editing window)
const UNIT_SEC = 60;          // finest bucket granularity (1 minute)

/** Thin out old history entries. Returns the affected count; dryRun only counts. */
export async function thinHistory(db: Db, dryRun = false): Promise<number> {
  const now = unixTime();
  const widths = Array.from({ length: Math.ceil(Math.log2(now / (DENSITY * UNIT_SEC))) + 1 }, (_, i) => UNIT_SEC * 2 ** i);
  // epoch-anchored bucket; width = UNIT × 2^k chosen so width ≈ age / DENSITY,
  // floored at UNIT → derives from the entry's own age, stable across runs.
  const bucket = (col: Sql) => {
    const age = sql`${now} - ${col}`;
    const width = db.dialect === "sqlite"
      ? sql`CASE ${sql.join(widths.slice(1).map((w, i) => sql`WHEN ${age} < ${DENSITY * w} THEN ${widths[i]}`), " ")} ELSE ${widths.at(-1)} END`
      : sql`(${UNIT_SEC} * POWER(2, GREATEST(0, FLOOR(LN(GREATEST(${age}, 1) * 1.0 / ${DENSITY * UNIT_SEC}) / LN(2)))))`;
    return sql`(${col} - (${col} % (${width})))`;
  };

  let count = 0;
  for (const t of Object.keys(versedTables(db))) {
    const vt = versTable(db, t);
    if (!vt) continue;
    const pks = (await db.columns(t)).filter((c) => c.Key === "PRI").map((c) => c.Field);
    const ids = [...pks, "_vers_space", "_vers_log"];
    const cols = sql.join(ids.map((f) => sql`m.${sql.id(f)}`));
    const join = sql.join(pks.map((f) => sql`mm.${sql.id(f)} = m.${sql.id(f)}`), " AND ");
    // m is deletable if a newer entry mm of the same row falls into the same bucket
    const body = sql`FROM ${sql.id(vt)} m
      JOIN log l ON l.id = m._vers_log
      JOIN ${sql.id(vt)} mm ON mm._vers_space = m._vers_space AND ${join} AND mm._vers_log > m._vers_log
      JOIN log ll ON ll.id = mm._vers_log
      WHERE l.time < ${now - KEEP_RECENT_SEC} AND ${bucket(sql`l.time`)} = ${bucket(sql`ll.time`)}`;
    if (dryRun) {
      count += Number(await db.one`SELECT COUNT(*) FROM (SELECT DISTINCT ${cols} ${body}) doomed`);
    } else if (db.dialect === "mysql") {
      count += Number((await db.exec`DELETE m ${body}`).affectedRows ?? 0);
    } else {
      count += Number((await db.exec`DELETE FROM ${sql.id(vt)} WHERE (${sql.join(ids.map(sql.id))}) IN (SELECT ${cols} ${body})`).affectedRows ?? 0);
    }
  }
  return count;
}
