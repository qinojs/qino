/**
 * cms.backend.system/cron1.ts
 * Port of cms.backend.system/cron1.php
 */

// deno-lint-ignore-file no-explicit-any

import type { App } from "../core/server.ts";

export async function daily(app: App): Promise<void> {
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

}
