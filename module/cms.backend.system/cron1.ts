/**
 * cms.backend.system/cron1.ts
 * Port of cms.backend.system/cron1.php
 */

// deno-lint-ignore-file no-explicit-any

export async function daily(app: any): Promise<void> {
  const db      = app.db;
  const appPATH = app.appPATH as string;

  // ── remove tmp files older than 1 hour ─────────────────────────────────
  const tmpDir  = appPATH + "cache/tmp/";
  const oneHour = 60 * 60 * 1000;
  async function cleanTmp(dir: string): Promise<void> {
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (entry.name.startsWith(".")) continue;
        const full = dir + entry.name;
        if (entry.isDirectory) {
          await cleanTmp(full + "/");
        } else {
          const stat = await Deno.stat(full);
          const mtime = stat.mtime?.getTime() ?? 0;
          if (mtime < Date.now() - oneHour) {
            await Deno.remove(full).catch(() => {});
          }
        }
      }
    } catch { /* skip if dir missing */ }
  }
  await cleanTmp(tmpDir);

  // ── optimise db tables ─────────────────────────────────────────────────
  const tables = await db.col("SHOW TABLES") as string[];
  for (const table of tables) {
    await db.query(`OPTIMIZE TABLE \`${table}\``).catch(() => {});
  }

  // ── check utf8mb4 migration ────────────────────────────────────────────
  const [, database = ""] = (app.dbConn ?? "").match(/dbname=([^;]+)/) ?? [];
  if (database) {
    const cols = await db.all(
      `SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE table_schema = ${db.constructor.quote ? db.constructor.quote(database) : `'${database}'`}`
    ).catch(() => [] as any[]);
    for (const row of cols) {
      if (!row.COLUMN_KEY) continue;
      if (Number(row.CHARACTER_MAXIMUM_LENGTH) <= 191) continue;
      const textTypes = new Set(["text", "tinytext", "mediumtext", "longtext"]);
      if (textTypes.has(row.DATA_TYPE)) continue;
      // PROCEDURE ANALYSE() is deprecated/removed in MySQL 8; skip silently
      console.warn(
        `migrate utf8mb4 warning: field ${row.TABLE_NAME}.${row.COLUMN_NAME} has CHARACTER_MAXIMUM_LENGTH ${row.CHARACTER_MAXIMUM_LENGTH} > 191`
      );
    }
  }
}
