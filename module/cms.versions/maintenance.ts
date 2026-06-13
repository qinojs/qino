// deno-lint-ignore-file no-explicit-any

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

import type { Db } from "../core/mod.ts";
import { versTable, versedTables } from "./lib/Vers.ts";

const DENSITY = 24;           // ~snapshots kept per age doubling (higher = keep more)
const KEEP_RECENT_SEC = 3600; // <1h untouched (still in the active editing window)
const UNIT_SEC = 60;          // finest bucket granularity (1 minute)

/** Thin out old history entries. Returns the affected count; dryRun only counts. */
export async function thinHistory(db: Db, dryRun = false): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    // epoch-anchored bucket; width = UNIT × 2^k chosen so width ≈ age / DENSITY,
    // floored at UNIT → derives from the entry's own age, stable across runs.
    const bucket = (col: string) => {
        const age   = `GREATEST(${now} - ${col}, 1)`;
        const steps = `GREATEST(0, FLOOR(LN(${age} / ${DENSITY * UNIT_SEC}) / LN(2)))`;
        // width parenthesised: `%` and `*` share precedence, so `col % UNIT * POW(..)`
        // would wrongly bind as `(col % UNIT) * POW(..)`.
        const width = `(${UNIT_SEC} * POW(2, ${steps}))`;
        return `(${col} - (${col} % ${width}))`;
    };

    let count = 0;
    for (const t of Object.keys(versedTables(db))) {
        const vt = await versTable(db, t);
        if (!vt) continue;
        const pks = (await db.all(`SHOW COLUMNS FROM ${t}`)).filter((c: any) => c.Key === "PRI").map((c: any) => c.Field);
        const join = pks.map((f: string) => `mm.\`${f}\` = m.\`${f}\``).join(" AND ");
        // m is deletable if a newer entry mm of the same row falls into the same bucket
        const body =
            `FROM \`${vt}\` m ` +
            `JOIN log l ON l.id = m._vers_log ` +
            `JOIN \`${vt}\` mm ON mm._vers_space = m._vers_space AND ${join} AND mm._vers_log > m._vers_log ` +
            `JOIN log ll ON ll.id = mm._vers_log ` +
            `WHERE l.time < ${now - KEEP_RECENT_SEC} AND ${bucket("l.time")} = ${bucket("ll.time")}`;
        if (dryRun) {
            const distinct = [...pks.map((f: string) => `m.\`${f}\``), "m._vers_space", "m._vers_log"].join(", ");
            count += Number(await db.one(`SELECT COUNT(DISTINCT ${distinct}) ${body}`));
        } else {
            count += Number((await db.exec(`DELETE m ${body}`)).affectedRows ?? 0);
        }
    }
    return count;
}
