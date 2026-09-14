import type { Db } from "./db/Db.ts";

const has = async (db: Db, table: string) => !!(await db.columns(table).catch(() => [])).length;

/** One-off: `text` carried (id, lang, text), which no dialect can auto-increment on a composite
 *  key — on SQLite every generate() left a row with a NULL id behind. The language rows now live
 *  in `text_lang`, `text` keeps the identity. Ids stay, so page.title_id keeps pointing home.
 *
 *  Removable once every installation has booted once (> 1.0).
 *
 *  Two halves around the schema migration, because that one would change the primary key of a
 *  table still full of duplicate ids and fail. So the rows are parked in plain copies, the old
 *  tables are dropped (their indexes go with them), the schema migration builds both tables
 *  fresh, and the parks are poured back. A run that breaks off resumes from the parks. */
export async function parkText(db: Db): Promise<void> {
  if (!(await db.columns("text").catch(() => [])).some((c) => c.Field === "lang")) return;
  await db.exec`CREATE TABLE text_park AS SELECT id AS text_id, lang, text, log_id, log_id_ch FROM text WHERE id IS NOT NULL`;
  await db.exec`DROP TABLE text`;
  // Text history, where cms.versions is installed; the identity alone has none worth keeping.
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
