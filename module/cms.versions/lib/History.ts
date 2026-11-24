// deno-lint-ignore-file no-explicit-any

// History capture (cms-agnostic): copies every write on a versioned table into its _vers_* table,
// keyed by the request's log entry. Writes without request (cron/CLI/boot) get a log entry of
// their own, else a restore would bring back the state before them.
import { requestStorage, sql, unixTime } from "@qino/qino";

import { getVers, getVersTable } from "./Vers.ts";

import type { App, Db, DbEvents, Sql } from "@qino/qino";

function replaceFrom(db: Db, versTable: string, cols: Record<string, any>[], source: Sql) {
  if (db.dialect !== "postgres") return db.exec`REPLACE INTO ${sql.id(versTable)} ${source}`;
  const keys = cols.filter((c) => c.Key === "PRI").map((c) => c.Field);
  const set = cols.filter((c) => c.Key !== "PRI").map((c) => sql`${sql.id(c.Field)} = excluded.${sql.id(c.Field)}`);
  return db.exec`INSERT INTO ${sql.id(versTable)} ${source} ON CONFLICT (${sql.join(keys.map(sql.id))}) DO UPDATE SET ${sql.join(set)}`;
}

/** The shadow table's columns, as loaded with the table (no query), and a snapshot row's select
 *  list in that order. */
const columnsOf = (db: Db, versTable: string) => [...db.table(versTable).fields!.values()].map((f) => f.vs);
const snapshot = (cols: Record<string, any>[], space: number, logId: string, deleted: boolean) => sql.join(cols.map((c) => {
  const f = c.Field;
  if (f === "_vers_space")   return sql`${space}`;
  if (f === "_vers_log")     return sql`${logId}`;
  if (f === "_vers_deleted") return sql.raw(deleted ? "1" : "0");
  return sql.id(f);
}));

export function initHistory(app: App, signal: AbortSignal) {

  // Writes without request share one log entry, until a request's entry comes after it — then the
  // next one gets a newer entry, so the history keeps the order of the writes.
  let ownLog: Promise<string | null> | undefined;

  // space + shadow table + logId for a tracked write, or null to skip. logId is awaited only after
  // the table check; earlier, the log insert's own insert-after would wait for itself.
  const track = async (e: any) => {
    const ctx = requestStorage.getStore();
    const tableName = String(e.table);
    if (tableName === "log" && ctx) ownLog = undefined;
    const versTable = getVersTable(app.db, tableName);
    if (!versTable) return null;
    const logId = await (ctx ? ctx.logId : ownLog ??= app.db.table("log").insert({ time: unixTime() }).then((id) => id ? String(id) : null, () => null));
    if (!logId) return null;
    return { space: ctx ? getVers(ctx).space : 0, tableName, versTable, logId };
  };

  // ─── History capture: insert/update ──────────────────────────────────────
  // Writes one _vers_* snapshot for every tracked table mutation.
  const catchInsertUpdate = async (e: DbEvents["table:insert-after"]) => {
    const t = await track(e);
    if (!t) return;
    const { space, tableName, versTable, logId } = t;
    const where = e.table.entryIdToFragment(e.id);
    if (!where) return;
    const versCols = columnsOf(app.db, versTable);
    await replaceFrom(app.db, versTable, versCols, sql`SELECT ${snapshot(versCols, space, logId, false)} FROM ${sql.id(tableName)} WHERE ${where}`);
  };
  app.db.on("table:update-after", catchInsertUpdate, { signal });
  app.db.on("table:insert-after", catchInsertUpdate, { signal });

  // ─── History capture: delete ──────────────────────────────────────────────
  app.db.on("table:delete-after", async (e) => {
    const t = await track(e);
    if (!t) return;
    const { space, versTable, logId } = t;
    const where = e.table.entryIdToFragment(e.id);
    if (!where) return;
    // The live row is gone: copy its latest snapshot with _vers_deleted set, so all NOT NULL
    // columns are filled.
    const versCols = columnsOf(app.db, versTable);
    await replaceFrom(app.db, versTable, versCols, sql`SELECT ${snapshot(versCols, space, logId, true)} FROM (
      SELECT * FROM ${sql.id(versTable)} WHERE ${where} AND _vers_space = ${space}
      ORDER BY _vers_log DESC LIMIT 1) AS src`);
  }, { signal });

  // ─── File protection: don't delete blobs referenced in _vers_file ────────
  // Blobs can't be restored (rows can, from snapshots). Historical pages serve them through
  // dbFile:resolve (plugin.ts).
  app.on("dbFile:unlink-before", async (e) => {
    const md5 = e.file?.vs?.md5 ?? "";
    if (!md5) return;
    if (await app.db.one`SELECT id FROM _vers_file WHERE md5 = ${md5}`.catch(() => null)) e.prevent = true;
  }, { signal });
}
