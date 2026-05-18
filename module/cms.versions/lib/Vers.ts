/**
 * cms.versions/lib/Vers.ts
 * Port of cms.versions/vers.class.php + vers.events.php
 *
 * Manages versioned shadow tables (_vers_<table>) and MySQL VIEWs for
 * point-in-time / draft-space reads.
 */

// deno-lint-ignore-file no-explicit-any

import { getCtx, type RequestContext } from "../../core/lib/RequestContext.ts";
import type { Db } from "../../core/lib/Db.ts";

// Tables (and optional field-subset) that are versioned.
// true  = version all fields
// array = only version these fields (rest come from live table)
export const versedTables: Record<string, true | Record<string, 1>> = {};

// App-level cache: which _vers_* tables have been created this process.
const versTableCreated = new Set<string>();

// ─── Per-request state ───────────────────────────────────────────────────────

export interface CmsVersState {
    versSpace: number;
    versLog: number;
    versTableEntriesCopying: boolean;
    cmsVersSpace: number;
    cmsVersLog: number;
}

const STATE_KEY = "cms.versions";

export function getCmsVers(ctx: RequestContext): CmsVersState {
    if (!ctx.state[STATE_KEY]) {
        ctx.state[STATE_KEY] = { versSpace: 0, versLog: 0, versTableEntriesCopying: false, cmsVersSpace: 0, cmsVersLog: 0 };
    }
    return ctx.state[STATE_KEY] as CmsVersState;
}

// ─── State helpers (replace PHP static vars) ────────────────────────────────

export function setSpace(ctx: RequestContext, space: number): number {
    const s = getCmsVers(ctx);
    const old = s.versSpace;
    s.versSpace = space;
    return old;
}
export function setLog(ctx: RequestContext, log: number): number {
    const s = getCmsVers(ctx);
    const old = s.versLog;
    s.versLog = log;
    return old;
}
/** setVers(ctx, [space,log]) — returns [oldSpace,oldLog] */
export function setVers(ctx: RequestContext, spaceLog: [number, number] | null): [number, number] {
    spaceLog ||= [0, 0];
    return [setSpace(ctx, spaceLog[0]), setLog(ctx, spaceLog[1])];
}

// ─── Table management ───────────────────────────────────────────────────────

/**
 * Ensure the _vers_<table> shadow table exists.
 * Port of vers::versTable().
 * Returns the shadow table name, or false if the table is not versioned.
 */
export async function versTable(db: Db, tableName: string): Promise<string | false> {
    if (!versedTables[tableName]) return false;
    const vt = `_vers_${tableName}`;
    if (versTableCreated.has(vt)) return vt;

    // Create shadow table if not present
    const exists = await db.one(
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
        [vt]
    );
    if (!exists) {
        await db.query(`CREATE TABLE ${vt} LIKE ${tableName}`);

        // Remove AUTO_INCREMENT from PK columns (shadow table uses composite PK)
        const pkCols: string[] = [];
        const cols = await db.all(`SHOW COLUMNS FROM ${vt}`);
        for (const col of cols) {
            if (col.Key === "PRI") pkCols.push(col.Field);
            if (col.Extra?.includes("auto_increment")) {
                await db.query(`ALTER TABLE ${vt} MODIFY ${col.Field} ${col.Type} NOT NULL`);
            }
        }

        // Add versioning columns and extend PK
        const allPk = [...pkCols, "_vers_log", "_vers_space"].map(c => `\`${c}\``).join(", ");
        await db.query(
            `ALTER TABLE ${vt}
             DROP PRIMARY KEY,
             ADD COLUMN \`_vers_log\`     INT UNSIGNED NOT NULL DEFAULT 0,
             ADD COLUMN \`_vers_space\`   INT UNSIGNED NOT NULL DEFAULT 0,
             ADD COLUMN \`_vers_deleted\` TINYINT UNSIGNED NOT NULL DEFAULT 0,
             ADD PRIMARY KEY (${allPk}),
             ADD INDEX (\`_vers_deleted\`)`
        );
    } else {
        // Ensure new columns from the live table exist in the shadow table
        const liveCols  = new Set((await db.all(`SHOW COLUMNS FROM ${tableName}`)).map((c: any) => c.Field));
        const versCols  = new Set((await db.all(`SHOW COLUMNS FROM ${vt}`)).map((c: any) => c.Field));
        for (const col of liveCols) {
            if (!versCols.has(col)) {
                const def = (await db.row(`SHOW COLUMNS FROM ${tableName} WHERE Field = ?`, [col])) as any;
                const nullable = def.Null === "YES" ? "NULL" : "NOT NULL DEFAULT ''";
                await db.query(`ALTER TABLE ${vt} ADD COLUMN \`${col}\` ${def.Type} ${nullable}`);
            }
        }
    }

    versTableCreated.add(vt);
    return vt;
}

// ─── View management ────────────────────────────────────────────────────────

/**
 * Return the table name to use for a given table/space/log combination.
 *
 * - space=0, log=0  → live table (no view)
 * - space≠0, log=0  → VIEW of _vers_<table> at space head (log=0 rows)
 * - space≠0, log≠0  → VIEW of _vers_<table> up to that log entry (historical)
 *
 * Port of vers::view().
 * Created views are registered on ctx.state.versViews for cleanup after response.
 */
export async function view(db: Db, tableName: string, space: number, log: number): Promise<string> {
    if (!versedTables[tableName]) return tableName;
    if (space === 0 && log === 0) return tableName;

    const vt   = `_vers_${tableName}`;
    const name = `_vers_${log}_space_${space}_${tableName}`;

    const ctx = getCtx();
    ctx.state.versViews ||= new Set<string>();

    if (!ctx.state.versViews.has(name)) {
        // Build field list: versioned fields from shadow table, rest from live table.
        const liveFields = await db.all(`SHOW COLUMNS FROM ${tableName}`);
        const fieldSpec   = versedTables[tableName];
        const selects: string[] = [];
        const pkJoins:  string[] = [];
        const origJoins: string[] = [];

        for (const col of liveFields) {
            const f = col.Field as string;
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

        // Add vers_space annotation used by page::construct
        selects.push(`${space} AS vers_space`);

        let sql: string;
        if (log) {
            // Historical view: most recent entry up to (log-1)
            sql =
                `CREATE VIEW \`${name}\` AS ` +
                `SELECT ${selects.join(", ")} ` +
                `FROM ${vt} m ` +
                `LEFT JOIN \`${tableName}\` original ON ${origJoins.join(" AND ")} ` +
                `WHERE !m._vers_deleted ` +
                `  AND m._vers_space = ${space} ` +
                `  AND m._vers_log BETWEEN 1 AND ${log - 1} ` +
                `  AND NOT EXISTS ( ` +
                `    SELECT 1 FROM ${vt} mm ` +
                `    WHERE mm._vers_space = ${space} ` +
                `      AND mm._vers_log BETWEEN 1 AND ${log - 1} ` +
                `      AND mm._vers_log > m._vers_log ` +
                `      AND ${pkJoins.join(" AND ")} ` +
                `    LIMIT 1 ` +
                `  )`;
        } else {
            // Space head view (log=0 = current draft)
            sql =
                `CREATE VIEW \`${name}\` AS ` +
                `SELECT ${selects.join(", ")} ` +
                `FROM ${vt} m ` +
                `LEFT JOIN \`${tableName}\` original ON ${origJoins.join(" AND ")} ` +
                `WHERE m._vers_space = ${space} AND m._vers_log = 0`;
        }

        await db.query(`DROP VIEW IF EXISTS \`${name}\``);
        await db.query(sql);
        ctx.state.versViews.add(name);
    }
    return name;
}

/**
 * Drop all views created during this request.
 * Call this after the response has been sent (port of register_shutdown_function).
 */
export async function dropRequestViews(db: Db): Promise<void> {
    const ctx = getCtx();
    if (!ctx.state.versViews?.size) return;
    for (const name of ctx.state.versViews) {
        await db.query(`DROP VIEW IF EXISTS \`${name}\``).catch(() => {/* ignore */});
    }
}

// ─── ensureSpace ────────────────────────────────────────────────────────────

/**
 * Ensure a space exists in vers_space and that _vers_* tables are seeded.
 * Port of vers::ensureSpace().
 */
export async function ensureSpace(db: Db, space: number): Promise<void> {
    if (!space) return;
    const exists = await db.row("SELECT space FROM vers_space WHERE space = ?", [space]);
    if (exists) return;

    // Seed each versioned table with live data
    for (const tableName of Object.keys(versedTables)) {
        const vt = await versTable(db, tableName);
        if (!vt) continue;
        await db.query(`DELETE FROM \`${vt}\` WHERE _vers_space = ?`, [space]);
        await db.query(`INSERT INTO \`${vt}\` SELECT *, 0, ?, 0 FROM \`${tableName}\``, [space]);
    }
    await db.table("vers_space").insert({ space, time_created: new Date() });
    // fire so other modules (like history.php) can react
    const ctx = getCtx();
    await ctx.app.fire("vers::createSpace", { space });
}

// ─── tableEntriesCopyTo ─────────────────────────────────────────────────────

/**
 * Copy entries from (fromSpace, fromLog) → toSpace.
 * Port of vers::tableEntriesCopyTo().
 */
export async function tableEntriesCopyTo(
    db: Db,
    tableName: string,
    filter: Record<string, any>,
    fromSpace: number,
    fromLog: number,
    toSpace: number,
): Promise<void> {
    const Table   = db.table(tableName);
    const [where, whereParams] = Table.valuesToFragment(filter);
    const fromView = await view(db, tableName, fromSpace, fromLog);
    const toView   = await view(db, tableName, toSpace, 0);

    const oldEntries: Record<string, any> = {};
    const newEntries: Record<string, any> = {};

    for (const e of await db.all(`SELECT * FROM \`${toView}\` WHERE ${where}`, whereParams))   oldEntries[Table.entryId(e) as string] = e;
    for (const e of await db.all(`SELECT * FROM \`${fromView}\` WHERE ${where}`, whereParams)) newEntries[Table.entryId(e) as string] = e;

    const ctx = getCtx();
    const s = getCmsVers(ctx);
    const oldVers = setVers(ctx, [toSpace, 0]);
    s.versTableEntriesCopying = true;
    for (const [id, entry] of Object.entries(newEntries)) {
        oldEntries[id] ? await Table.update(entry) : await Table.ensure(entry);
    }
    for (const [id, entry] of Object.entries(oldEntries)) {
        if (!newEntries[id]) await Table.delete(entry);
    }
    s.versTableEntriesCopying = false;
    setVers(ctx, oldVers);
}
