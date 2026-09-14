import type { Db } from "./db/Db.ts";

/** One-off: `text` carried (id, lang, text), which no dialect can auto-increment on a composite
 *  key — on SQLite every generate() left a row with a NULL id behind. The language rows now live
 *  in `text_lang`, `text` keeps the identity. Ids stay, so page.title_id keeps pointing home.
 *
 *  `text` is dropped rather than renamed: its indexes carry their names along and would collide
 *  with the ones the new table wants. `text_ids` holds the identities meanwhile — as a table, so
 *  an interrupted run resumes instead of losing them. */
export async function migrateTextLang(db: Db): Promise<void> {
  const cols = async (t: string) => await db.columns(t).catch(() => []);
  const legacy = (await cols("text")).some((c) => c.Field === "lang");
  if (!legacy && !(await cols("text_ids")).length) return;
  if (legacy) {
    await db.exec`INSERT INTO text_lang (text_id, lang, text, log_id_ch) SELECT id, lang, text, log_id_ch FROM text WHERE id IS NOT NULL`;
    // Text history, where cms.versions is installed; the identity alone has none worth keeping.
    await db.exec`INSERT INTO _vers_text_lang (text_id, lang, text, log_id_ch, _vers_log, _vers_space, _vers_deleted)
      SELECT id, lang, text, log_id_ch, _vers_log, _vers_space, _vers_deleted FROM _vers_text WHERE id IS NOT NULL`.catch(() => {});
    await db.exec`CREATE TABLE text_ids AS SELECT id, MIN(log_id) AS log_id FROM text WHERE id IS NOT NULL GROUP BY id`;
    await db.exec`DROP TABLE text`;
    await db.exec`DROP TABLE _vers_text`.catch(() => {});
    await db.migrate(db.schema, { patch: true }); // recreates both in their new shape
  }
  await db.exec`INSERT INTO text (id, log_id) SELECT id, log_id FROM text_ids`;
  await db.exec`DROP TABLE text_ids`;
  await db.syncAutoIncrement("text", "id", Number(await db.one`SELECT MAX(id) FROM text`) || 0);
  await db.loadTables();
}
