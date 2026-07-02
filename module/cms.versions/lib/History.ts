// deno-lint-ignore-file no-explicit-any

// History capture (cms-agnostic): mirrors every mutation of a versioned table
// into its _vers_* shadow table, keyed by the request's log entry.
// Writes without request context (cron/CLI/boot) are not captured — capture
// is keyed to ctx.logId, so there is no log entry to attach them to.

import { requestStorage, sql, type App, type DbEvents } from "../../core/mod.ts";
import { getVers, versTable } from "./Vers.ts";

export function initHistory(app: App) {

    // Resolve request ctx + shadow table + logId for a tracked mutation, or null to skip.
    // logId is awaited only after the versioned-table check: awaiting earlier deadlocks
    // during the log insert's own insert-after (it would wait on its own pending logId).
    const track = async (e: any): Promise<{ ctx: any; tableName: string; vt: string; logId: any } | null> => {
        const ctx = requestStorage.getStore();
        if (!ctx) return null;
        const tableName: string = String(e.Table);
        if (tableName.startsWith("_vers_") && !e.data?._vers_log) return null; // writing to vers table – let through
        const vt = versTable(ctx.app.db, tableName);
        if (!vt) return null;
        const logId = await ctx.logId;
        if (!logId) return null;
        return { ctx, tableName, vt, logId };
    };

    // ─── History capture: insert/update ──────────────────────────────────────
    // Writes a REPLACE INTO _vers_* for every tracked table mutation.
    const catchInsertUpdate = async (e: DbEvents["table::insert-after"]) => {
        const t = await track(e);
        if (!t) return;
        const { ctx, tableName, vt, logId } = t;
        // Build field list from _vers_* table to ensure correct column order
        const versCols = await ctx.app.db.columns(vt);
        const selects = versCols.map((c: any) => {
            const f = c.Field;
            if (f === "_vers_space")   return sql`${getVers(ctx).space}`;
            if (f === "_vers_log")     return sql`${logId}`;
            if (f === "_vers_deleted") return sql.raw("0");
            return sql.id(f);
        });
        const where = e.Table.entryIdToFragment(e.id);
        if (!where) return;
        await ctx.app.db.query`REPLACE INTO ${sql.id(vt)} SELECT ${sql.join(selects)} FROM ${sql.id(tableName)} WHERE ${where}`;
    };
    app.db.on("table::update-after", catchInsertUpdate);
    app.db.on("table::insert-after", catchInsertUpdate);

    // ─── History capture: delete ──────────────────────────────────────────────
    app.db.on("table::delete-after", async (e) => {
        const t = await track(e);
        if (!t) return;
        const { ctx, vt, logId } = t;
        const where = e.Table.entryIdToFragment(e.id);
        if (!where) return;
        // The live row is gone, so copy its most recent snapshot and flip _vers_deleted.
        // This keeps every (NOT NULL) column populated, mirroring the insert/update capture above —
        // a partial VALUES insert would break on data columns that have no default.
        const space = getVers(ctx).space;
        const versCols = await ctx.app.db.columns(vt);
        const selects = versCols.map((c: any) => {
            const f = c.Field;
            if (f === "_vers_space")   return sql`${space}`;
            if (f === "_vers_log")     return sql`${logId}`;
            if (f === "_vers_deleted") return sql.raw("1");
            return sql.id(f);
        });
        await ctx.app.db.query`REPLACE INTO ${sql.id(vt)} SELECT ${sql.join(selects)} FROM (
            SELECT * FROM ${sql.id(vt)} WHERE ${where} AND _vers_space = ${space}
            ORDER BY _vers_log DESC LIMIT 1
        ) AS src`;
    });

    // ─── File protection: don't delete blobs referenced in _vers_file ────────
    // Blobs are the only unrecoverable data (rows can be rebuilt from snapshots).
    // TODO: dbFile output should fall back to the _vers_file snapshot when the
    // live row is gone, so history views can still serve these preserved blobs.
    app.on("dbFile-remove-fs", async (e) => {
        const md5 = e.dbFile?.vs?.md5 ?? "";
        if (!md5) return;
        const inVers = await app.db.one`SELECT id FROM _vers_file WHERE md5 = ${md5}`.catch(() => null);
        if (inVers) e.prevent = true;
    });
}
