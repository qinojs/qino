import type { Db } from "./db/Db.ts";

const has = async (db: Db, table: string) => !!(await db.columns(table).catch(() => [])).length;

/** One-off: `text` had (id, lang, text), a composite key no dialect can auto-increment (SQLite left
 *  rows with NULL id). Now language rows are in `text_lang`, `text` keeps the id. Ids stay, so
 *  page.title_id stays valid.
 *
 *  Removable once every installation has booted once (> 1.0).
 *
 *  Two steps around the schema migration, which would fail on a table with duplicate ids: copy the
 *  rows aside, drop the old tables, let the migration create both tables, copy the rows back. An
 *  interrupted run continues from the copies. */
export async function parkText(db: Db): Promise<void> {
  if (!(await db.columns("text").catch(() => [])).some((c) => c.Field === "lang")) return;
  await db.exec`CREATE TABLE text_park AS SELECT id AS text_id, lang, text, log_id, log_id_ch FROM text WHERE id IS NOT NULL`;
  await db.exec`DROP TABLE text`;
  // Text history, if cms.versions is installed.
  if (!await has(db, "_vers_text")) return;
  await db.exec`CREATE TABLE text_vers_park AS SELECT id AS text_id, lang, text, log_id_ch, _vers_log, _vers_space, _vers_deleted FROM _vers_text WHERE id IS NOT NULL`;
  await db.exec`DROP TABLE _vers_text`;
}

export async function unparkText(db: Db): Promise<void> {
  if (!await has(db, "text_park")) return;
  await db.exec`INSERT INTO text (id, log_id) SELECT text_id, MIN(log_id) FROM text_park GROUP BY text_id`;
  await db.exec`INSERT INTO text_lang (text_id, lang, text, log_id_ch) SELECT text_id, lang, text, log_id_ch FROM text_park`;
  await db.exec`DROP TABLE text_park`;
  if (await has(db, "text_vers_park")) {
    await db.exec`INSERT INTO _vers_text_lang (text_id, lang, text, log_id_ch, _vers_log, _vers_space, _vers_deleted)
      SELECT text_id, lang, text, log_id_ch, _vers_log, _vers_space, _vers_deleted FROM text_vers_park`;
    await db.exec`DROP TABLE text_vers_park`;
  }
  await db.syncAutoIncrement("text", "id", Number(await db.one`SELECT MAX(id) FROM text`) || 0);
  await db.loadTables();
}
