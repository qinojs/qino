// deno-lint-ignore-file no-explicit-any

// Spaces (cms-agnostic): parallel working copies of the versioned tables
// (space 0 = live). Space lifecycle + copying entries between spaces.

import { getCtx, requestStorage, type App, type Db } from "../../core/mod.ts";
import { getVers, setVers, versedTables, versTable, view } from "./Vers.ts";

// ─── ensureSpace ────────────────────────────────────────────────────────────

export async function ensureSpace(app: App, space: number): Promise<void> {
    if (!space) return;
    const db = app.db;
    const exists = await db.row("SELECT space FROM vers_space WHERE space = ?", [space]);
    if (exists) return;

    // Seed each versioned table with live data
    for (const tableName of Object.keys(versedTables(db))) {
        const vt = versTable(db, tableName);
        if (!vt) continue;
        // Build the select onto the shadow's own column order (not positional *,0,?,0),
        // so it stays correct even when the shadow's column order diverged from the live table.
        const selects = (await db.columns(vt)).map((c: any) =>
            c.Field === "_vers_space" ? "?" : c.Field.startsWith("_vers_") ? "0" : `\`${c.Field}\``);
        await db.query(`DELETE FROM \`${vt}\` WHERE _vers_space = ?`, [space]);
        await db.query(`INSERT INTO \`${vt}\` SELECT ${selects.join(", ")} FROM \`${tableName}\``, [space]);
    }
    await db.table("vers_space").insert({ space, time_created: new Date() });
    // fire so other modules can react
    await app.fire("vers::createSpace", { space });
}

// ─── tableEntriesCopyTo ─────────────────────────────────────────────────────

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
    const s = getVers(ctx);
    const oldVers = setVers(ctx, [toSpace, 0]);
    s.tableEntriesCopying = true;
    for (const [id, entry] of Object.entries(newEntries)) {
        oldEntries[id] ? await Table.update(entry) : await Table.ensure(entry);
    }
    for (const [id, entry] of Object.entries(oldEntries)) {
        if (!newEntries[id]) await Table.delete(entry);
    }
    s.tableEntriesCopying = false;
    setVers(ctx, oldVers);
}

// ─── App wiring ─────────────────────────────────────────────────────────────

export function initSpaces(app: App) {

    // ─── AUTO_INCREMENT sync: vers insert → live table ────────────────────────
    app.db.on("table::insert-after", async (e: any) => {
        const ctx = requestStorage.getStore();
        if (!ctx) return;
        if (getVers(ctx).space) return; // only in live space
        const tableName: string = String(e.Table);
        if (!tableName.startsWith("_vers_")) return;
        const originalTable = tableName.slice(6);
        const auto = e.Table.autoIncrement;
        if (!auto) return;
        const ids = e.Table.entryId2Array(e.id) ?? {};
        const value = Number(ids[String(auto)]);
        if (!value) return;
        await ctx.app.db.query(`ALTER TABLE \`${originalTable}\` AUTO_INCREMENT=${value + 1}`);
    });
}

/** vers_space table (cms-agnostic). Merged into the module dbSchema. */
export const versSpaceSchema = {
    additionalProperties: {
        properties: {
            space:        { type: "integer", "x-index": "primary" },
            time_created: { type: "string", format: "date-time" },
        },
    },
};
