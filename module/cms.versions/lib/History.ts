// deno-lint-ignore-file no-explicit-any

// History capture (cms-agnostic): mirrors every mutation of a versioned table
// into its _vers_* shadow table, keyed by the request's log entry.
// Writes without request context (cron/CLI/boot) are not captured — capture
// is keyed to ctx.logId, so there is no log entry to attach them to.

import { requestStorage, type App } from "../../core/mod.ts";
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
    const catchInsertUpdate = async (e: any) => {
        const t = await track(e);
        if (!t) return;
        const { ctx, tableName, vt, logId } = t;
        // Build field list from _vers_* table to ensure correct column order
        const versCols = await ctx.app.db.columns(vt);
        const selects = versCols.map((c: any) => {
            const f = c.Field;
            if (f === "_vers_space")   return `${getVers(ctx).space}`;
            if (f === "_vers_log")     return logId;
            if (f === "_vers_deleted") return "0";
            if (f === "offset")        return "`offset`";
            return `\`${f}\``;
        });
        const where = e.Table.entryId2where(e.id);
        if (!where) return;
        await ctx.app.db.query(`REPLACE INTO \`${vt}\` SELECT ${selects.join(", ")} FROM \`${tableName}\` WHERE ${where}`);
    };
    app.db.on("table::update-after", catchInsertUpdate);
    app.db.on("table::insert-after", catchInsertUpdate);

    // ─── History capture: delete ──────────────────────────────────────────────
    app.db.on("table::delete-after", async (e: any) => {
        const t = await track(e);
        if (!t) return;
        const { ctx, vt, logId } = t;
        const ids = e.Table.entryId2Array(e.id) ?? {};
        const data: Record<string, any> = {
            ...ids,
            _vers_log:     logId,
            _vers_space:   getVers(ctx).space,
            _vers_deleted: 1,
        };
        const VT = ctx.app.db.table(vt);

        // const [set, params] = VT.valuesToFragment(data, undefined, true);
        // await ctx.app.db.exec(`REPLACE INTO \`${vt}\` SET ${set}`, params);
        // SQLite has no REPLACE ... SET; use the portable (cols) VALUES (?) form (mirrors DbTable.insert).
        const cols = Object.keys(VT.fields!).filter((f) => f in data);
        const params = cols.map((f) => VT.fields![f].valueTransform(data[f]));
        const into = `(${cols.map((c) => `\`${c}\``).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
        await ctx.app.db.exec(`REPLACE INTO \`${vt}\` ${into}`, params);
    });

    // ─── File protection: don't delete blobs referenced in _vers_file ────────
    // Blobs are the only unrecoverable data (rows can be rebuilt from snapshots).
    // TODO: dbFile output should fall back to the _vers_file snapshot when the
    // live row is gone, so history views can still serve these preserved blobs.
    app.on("dbFile-remove-fs", async (e: any) => {
        const md5 = e.dbFile?.vs?.md5 ?? "";
        if (!md5) return;
        const inVers = await app.db.one(
            "SELECT id FROM _vers_file WHERE md5 = ?", [md5]
        ).catch(() => null);
        if (inVers) e.prevent = true;
    });
}
