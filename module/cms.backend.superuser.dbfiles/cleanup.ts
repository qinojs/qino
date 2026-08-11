import { sql, unixTime, type App } from "../core/mod.ts";

/** Remove file rows no child table links to, older than a week. */
export async function deleteUnlinkedDb(app: App): Promise<{ deleted: number }> {
  const { db, dbFiles: fm } = app;
  const ago = unixTime() - 60 * 60 * 24 * 7;
  const notLinked = db.table("file").children.map((dbFile) =>
    sql`NOT EXISTS (SELECT 1 FROM ${sql.id(dbFile.table.name)} c WHERE c.${sql.id(dbFile.name)}=file.id)`);
  const rows = await db.query`SELECT file.id FROM file
    LEFT JOIN log log_i ON file.log_id=log_i.id LEFT JOIN log log_e ON file.log_id_ch=log_e.id
    WHERE (log_i.id IS NULL OR log_i.time<${ago}) AND (log_e.id IS NULL OR log_e.time<${ago})${notLinked.length ? sql` AND ${sql.join(notLinked, " AND ")}` : sql.raw("")}`;
  let deleted = 0;
  for (const row of rows) {
    const f = await fm.file(row.id);
    if (!await f.used() && !await f.access()) { await f.remove(); deleted++; }
  }
  return { deleted };
}
