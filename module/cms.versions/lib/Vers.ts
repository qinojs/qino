// deno-lint-ignore-file no-explicit-any

// Generic versioning core (cms-agnostic): table registry, per-request state,
// _vers_* shadow tables and (space,log)-views.
// History capture lives in History.ts, space handling in Spaces.ts.

import { sql, type Ctx, type App, type Db } from "../../core/mod.ts";

// ─── Per-Db state ────────────────────────────────────────────────────────────
// Keyed by Db instance — module globals would leak between App instances (multi-tenant).

interface DbVersState {
    tables: Record<string, true | Record<string, 1>>;
    baselined: Set<string>;             // baseline checked this process
    views: Map<string, Promise<void>>;  // (space,log)-views created this process
}
const dbStates = new WeakMap<Db, DbVersState>();
function dbState(db: Db): DbVersState {
    return dbStates.getOrInsertComputed(db, () => ({
        tables: {}, baselined: new Set(), views: new Map(),
    }));
}

// Tables (and optional field-subset) that are versioned.
// true   = version all fields
// record = only version these fields (rest come from live table)
export function versedTables(db: Db): DbVersState["tables"] {
    return dbState(db).tables;
}

// ─── Per-request state ───────────────────────────────────────────────────────

export interface VersState {
    space: number;
    log: number;
    tableEntriesCopying: boolean;
}

const STATE_KEY = "vers";

export function getVers(ctx: Ctx): VersState {
    return (ctx.state[STATE_KEY] ??= { space: 0, log: 0, tableEntriesCopying: false }) as VersState;
}

// ─── State helpers ──────────────────────────────────────────────────────────

export function setSpace(ctx: Ctx, space: number): number {
    const s = getVers(ctx);
    const old = s.space;
    s.space = space;
    return old;
}
export function setLog(ctx: Ctx, log: number): number {
    const s = getVers(ctx);
    const old = s.log;
    s.log = log;
    return old;
}
/** setVers(ctx, [space,log]) — returns [oldSpace,oldLog] */
export function setVers(ctx: Ctx, spaceLog: [number, number] | null): [number, number] {
    spaceLog ??= [0, 0];
    return [setSpace(ctx, spaceLog[0]), setLog(ctx, spaceLog[1])];
}

// ─── Table management ───────────────────────────────────────────────────────

/** Shadow table name for a versioned table, or undefined if it is not versioned.
 *  The _vers_* tables are created centrally via the schema (see plugin.ts
 *  extendDbSchema), so this is a pure lookup. */
export function versTable(db: Db, tableName: string): string | undefined {
    return versedTables(db)[tableName] ? `_vers_${tableName}` : undefined;
}

/** Derive the _vers_<table> shadow item-schema from a live table's schema:
 *  all fields (composite PK, no auto-increment) plus the _vers_ bookkeeping columns. */
export function shadowSchema(source: any): any {
    const shadow = structuredClone(source);
    const props = shadow.additionalProperties.properties as Record<string, any>;
    for (const p of Object.values(props)) delete p["x-autoincrement"]; // composite PK, not auto-increment
    props._vers_log     = { type: "integer", default: 0, "x-index": "primary" };
    props._vers_space   = { type: "integer", default: 0, "x-index": "primary" };
    props._vers_deleted = { type: "integer", default: 0, "x-index": true };
    return shadow;
}

// ─── View management ────────────────────────────────────────────────────────

/**
 * Return the table name to use for a given table/space/log combination.
 *
 * - space=0, log=0  → live table (no view)
 * - space≠0, log=0  → VIEW of _vers_<table> at space head (log=0 rows)
 * - space≠0, log≠0  → VIEW of _vers_<table> up to that log entry (historical)
 *
 * Head views (log=0) are cached per process and left in the db (deterministic
 * definitions; first use after boot recreates them). Historical views (log≠0)
 * are one-shot: not cached, and the caller drops them after use (else one set
 * accumulates per browsed log entry).
 */
export async function view(db: Db, tableName: string, space: number, log: number): Promise<string> {
    if (!versedTables(db)[tableName]) return tableName;
    if (space === 0 && log === 0) return tableName;

    const vt   = `_vers_${tableName}`;
    const name = `_vers_${log}_space_${space}_${tableName}`;

    if (log !== 0) { // one-shot, caller drops it
        await createView(db, tableName, vt, name, space, log);
        return name;
    }

    const views = dbState(db).views;
    const creating = views.getOrInsertComputed(name, () => {
        const creating = createView(db, tableName, vt, name, space, log);
        creating.catch(() => views.delete(name)); // allow retry after failure
        return creating;
    });
    await creating;
    return name;
}

async function createView(db: Db, tableName: string, vt: string, name: string, space: number, log: number): Promise<void> {
    // Build field list: versioned fields from shadow table, rest from live table.
    const liveFields = await db.columns(tableName);
    const fieldSpec   = versedTables(db)[tableName];
    const selects: string[] = [];
    const pkJoins:  string[] = [];
    const origJoins: string[] = [];

    for (const col of liveFields) {
        const f = col.Field;
        if (fieldSpec === true || (fieldSpec as Record<string,1>)[f]) {
            selects.push(`m.\`${f}\``);
        } else {
            selects.push(`original.\`${f}\``);
        }
        if (col.Key === "PRI") {
            pkJoins.push(`mm.\`${f}\` = m.\`${f}\``);
            origJoins.push(`m.\`${f}\` = original.\`${f}\``);
        }
    }

    // Add vers_space annotation used by page:construct
    selects.push(`${space} AS vers_space`);

    const head =
        `CREATE VIEW \`${name}\` AS SELECT ${selects.join(", ")} FROM ${vt} m ` +
        `LEFT JOIN \`${tableName}\` original ON ${origJoins.join(" AND ")} WHERE `;
    // log: historical view = most recent entry up to (log-1). Completeness (every live row
    // has ≥1 capture) is guaranteed by baselineTable(), so no live fallback is needed —
    // keeping the view UNION-free lets MySQL merge it (index pushdown on queries).
    // else: space head view (log=0 = current draft).
    const where = log
        ? `m._vers_deleted = 0 AND m._vers_space = ${space} AND m._vers_log BETWEEN 1 AND ${log - 1} ` +
          `AND NOT EXISTS ( SELECT 1 FROM ${vt} mm WHERE mm._vers_space = ${space} ` +
          `AND mm._vers_log BETWEEN 1 AND ${log - 1} AND mm._vers_log > m._vers_log ` +
          `AND ${pkJoins.join(" AND ")} LIMIT 1 )`
        : `m._vers_space = ${space} AND m._vers_log = 0`;

    await db.query`DROP VIEW IF EXISTS ${sql.id(name)}`;
    await db.query`${sql.raw(head + where)}`;
}

// ─── Baseline ────────────────────────────────────────────────────────────────

/**
 * Give rows that predate versioning one capture entry, so historical views
 * are complete (invariant: every live row has ≥1 _vers_ entry — keeps the
 * views UNION-free/mergeable). Idempotent, checked once per process.
 */
async function baselineTable(db: Db, tableName: string, vt: string, logId: number): Promise<void> {
    if (dbState(db).baselined.has(vt)) return;
    const pks = (await db.columns(tableName)).filter((c) => c.Key === "PRI").map((c) => c.Field);
    const join = pks.map((f) => `v.\`${f}\` = t.\`${f}\``).join(" AND ");
    // Map values onto the shadow's own column order (not positional t.*,…), so it stays
    // correct even when the shadow's column order has diverged from the live table.
    const selects = (await db.columns(vt)).map((c) =>
        c.Field === "_vers_log" ? sql`${logId}` : c.Field.startsWith("_vers_") ? sql.raw("0") : sql`t.${sql.id(c.Field)}`);
    await db.query`
        INSERT INTO ${sql.id(vt)} SELECT ${sql.join(selects)} FROM ${sql.id(tableName)} t
        WHERE NOT EXISTS (SELECT 1 FROM ${sql.id(vt)} v WHERE v._vers_space = 0 AND ${sql.raw(join)})`;
    dbState(db).baselined.add(vt);
}

// ─── App wiring (core) ───────────────────────────────────────────────────────

export function initVers(app: App, signal: AbortSignal) {

    // ─── Baseline versioned rows on first action ─────────────────────────────
    app.on("route", async ({ ctx }) => {
        const db = ctx.app.db;
        const { baselined } = dbState(db);
        const pending = Object.keys(versedTables(db)).filter((t) => !baselined.has(`_vers_${t}`));
        if (!pending.length) return;
        const logId = Number(await ctx.logId) || 0;
        if (!logId) return;
        for (const t of pending) await baselineTable(db, t, `_vers_${t}`, logId);
    }, { signal });
}
