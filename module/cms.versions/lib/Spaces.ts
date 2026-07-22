// Spaces (cms-agnostic): parallel working copies of the versioned tables
// (space 0 = live). Space lifecycle + copying entries between spaces.

import { getCtx, requestStorage, sql, type App, type Db, type Row } from "../../core/mod.ts";
import { getVers, setVers, versedTables, versTable, view } from "./Vers.ts";

// ─── ensureSpace ────────────────────────────────────────────────────────────

export async function ensureSpace(app: App, space: number): Promise<void> {
  if (!space) return;
  const db = app.db;
  if (await db.row`SELECT space FROM vers_space WHERE space = ${space}`) return;

  // Seed each versioned table with live data
  for (const tableName of Object.keys(versedTables(db))) {
    const vt = versTable(db, tableName);
    if (!vt) continue;
    // Build the select onto the shadow's own column order (not positional *,0,?,0),
    // so it stays correct even when the shadow's column order diverged from the live table.
    const selects = (await db.columns(vt)).map((c) =>
      c.Field === "_vers_space" ? sql`${space}` : c.Field.startsWith("_vers_") ? sql.raw("0") : sql.id(c.Field));
    await db.exec`DELETE FROM ${sql.id(vt)} WHERE _vers_space = ${space}`;
    await db.exec`INSERT INTO ${sql.id(vt)} SELECT ${sql.join(selects)} FROM ${sql.id(tableName)}`;
  }
  await db.table("vers_space").insert({ space, time_created: new Date() });
  // fire so other modules can react
  await app.fire("vers:createSpace", { space });
}

// ─── tableEntriesCopyTo ─────────────────────────────────────────────────────

export async function tableEntriesCopyTo(
  db: Db,
  tableName: string,
  filter: Row,
  fromSpace: number,
  fromLog: number,
  toSpace: number,
): Promise<void> {
  const Table   = db.table(tableName);
  const where   = Table.valuesToFragment(filter);
  const fromView = await view(db, tableName, fromSpace, fromLog);
  const toView   = await view(db, tableName, toSpace, 0);

  const oldEntries: Record<string, Row> = {};
  const newEntries: Record<string, Row> = {};

  for (const e of await db.query`SELECT * FROM ${sql.id(toView)} WHERE ${where}`)   oldEntries[Table.entryId(e)!] = e;
  for (const e of await db.query`SELECT * FROM ${sql.id(fromView)} WHERE ${where}`) newEntries[Table.entryId(e)!] = e;

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

export function initSpaces(app: App, signal: AbortSignal) {

  // ─── AUTO_INCREMENT sync: vers insert → live table ────────────────────────
  app.db.on("table:insert-after", async (e) => {
    const ctx = requestStorage.getStore();
    if (!ctx) return;
    if (getVers(ctx).space) return; // only in live space
    const tableName = String(e.table);
    if (!tableName.startsWith("_vers_")) return;
    const originalTable = tableName.slice(6);
    const auto = e.table.autoIncrement;
    if (!auto) return;
    const ids = e.table.entryIdValues(e.id) || {};
    const value = Number(ids[String(auto)]);
    if (!value) return;
    await ctx.app.db.query`ALTER TABLE ${sql.id(originalTable)} AUTO_INCREMENT=${sql.raw(String(value + 1))}`;
  }, { signal });
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
