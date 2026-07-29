import type { Node } from "../cms/mod.ts";
import { tableStatus, type TableStatus } from "../cms.backend.superuser.db/mod.ts";
import { cleanOrphans, dropExtraField, dropExtraTable, findOrphans, maintain, maintenanceActions } from "./lib/cleanup.ts";
import { createMissingIndex, dropRedundantIndex, reindexInvalid } from "./lib/indexes.ts";
import { syncSequence } from "./lib/sequences.ts";
import { validateTable } from "./lib/validate.ts";

const LARGE_ROWS = 100_000;
const LARGE_BYTES = 100_000_000;

export const isLarge = (status: TableStatus): boolean => (status.rows ?? 0) >= LARGE_ROWS || (status.bytes ?? 0) >= LARGE_BYTES;
const errorText = (e: unknown): string => e instanceof Error ? e.message : String(e);

export async function nodeApi(node: Node, vars: Record<string, unknown>) {
  const db = node.app.db;
  const action = String(vars.action ?? "");
  const table = String(vars.table ?? "");
  const field = String(vars.field ?? "");
  const index = String(vars.index ?? "");
  try {
    if (action === "clean-orphans") {
      const r = await cleanOrphans(db, table, field);
      return { message: `${r.cleaned} rows ${r.action === "cascade" ? "deleted" : "set to null"}${r.remaining ? `, ${r.remaining} remaining` : ""}`, tables: [table] };
    }
    if (action === "drop-table") {
      await dropExtraTable(db, table);
      return { message: `Table ${table} deleted`, remove: table };
    }
    if (action === "drop-field") {
      await dropExtraField(db, table, field);
      return { message: `Field ${table}.${field} deleted`, tables: [table] };
    }
    if (action === "create-index") {
      await createMissingIndex(db, table, field);
      return { message: `Index for ${table}.${field} created`, tables: [table] };
    }
    if (action === "drop-index") {
      await dropRedundantIndex(db, table, index);
      return { message: `Index ${index} deleted`, tables: [table] };
    }
    if (action === "reindex-index") {
      await reindexInvalid(db, table, index);
      return { message: `Index ${index} rebuilt`, tables: [table] };
    }
    if (action === "sync-sequence") {
      await syncSequence(db, table);
      return { message: `Auto-id sequence for ${table} synchronized`, tables: [table] };
    }
    if (action === "validate") {
      const issues = await validateTable(db, table);
      return { message: issues.length ? issues.map((issue) => `${table}.${issue.field}: ${issue.count} × ${issue.rule}`).join("\n") : `${table}: all portable schema checks passed` };
    }
    if (action === "clean-orphans-all") {
      const issues = (await findOrphans(db)).filter((issue) => issue.actionable);
      let cleaned = 0;
      let remaining = 0;
      for (const issue of issues) {
        const result = await cleanOrphans(db, issue.table, issue.field);
        cleaned += result.cleaned;
        remaining += result.remaining;
      }
      return { message: `${cleaned} orphan references cleaned${remaining ? `, ${remaining} remaining` : ""}`, tables: [...new Set(issues.map((issue) => issue.table))] };
    }
    if (action === "validate-all") {
      const failed: string[] = [];
      const skipped: string[] = [];
      for (const table of Object.keys(db.tables).sort()) {
        if (!(table in (db.schema?.properties ?? {}))) continue;
        const status = await tableStatus(db, table);
        if (isLarge(status)) { skipped.push(table); continue; }
        const issues = await validateTable(db, table);
        if (issues.length) failed.push(`${table}: ${issues.reduce((sum, issue) => sum + issue.count, 0)} violations`);
      }
      return { message: `${failed.length ? failed.join("\n") : "All portable schema checks passed"}${skipped.length ? `\nSkipped large tables: ${skipped.join(", ")}` : ""}` };
    }
    if (action === "vacuum") {
      if (db.dialect !== "sqlite") throw new Error("VACUUM is only available for SQLite here");
      await db.exec`VACUUM`;
      return { message: "Database vacuum completed", tables: Object.keys(db.tables) };
    }
    if (action === "maintenance") {
      const status = await tableStatus(db, table);
      return { message: await maintain(db, String(vars.maintenance ?? ""), table, status), tables: [table] };
    }
    if (action === "optimize-all") {
      const done: string[] = [];
      const skipped: string[] = [];
      const failed: string[] = [];
      for (const table of Object.keys(db.tables).sort()) {
        const status = await tableStatus(db, table);
        if (!maintenanceActions(db, status).includes("optimize")) continue;
        if (isLarge(status)) { skipped.push(table); continue; }
        try {
          await maintain(db, "optimize", table, status);
          done.push(table);
        } catch (e) { failed.push(`${table}: ${errorText(e)}`); }
      }
      return {
        message: `${done.length} tables optimized${skipped.length ? `; ${skipped.length} large tables skipped: ${skipped.join(", ")}` : ""}${failed.length ? `; failed: ${failed.join(", ")}` : ""}`,
        tables: done,
      };
    }
  } catch (e) { return { error: errorText(e) }; }
  return { error: "unknown action" };
}
