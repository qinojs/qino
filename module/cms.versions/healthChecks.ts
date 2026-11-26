import { sql } from "@qino/qino";

import { versedTables } from "./lib/Vers.ts";
import { thinHistory } from "./maintenance.ts";

import type { App, Db } from "@qino/qino";

/** Historical views from before each had a name of its own (`_vers_<log>_space_<n>_<table>`): they
 *  were never dropped. Their names are no longer made, so none is in use. */
async function strayViews(db: Db): Promise<string[]> {
  const all = db.dialect === "sqlite"
    ? await db.col<string>`SELECT name FROM sqlite_master WHERE type = 'view'`
    : await db.col<string>`SELECT table_name FROM information_schema.views WHERE table_schema = ${
      sql.raw(db.dialect === "mysql" ? "DATABASE()" : "current_schema()")}`;
  const tables = new Set(Object.keys(versedTables(db)));
  return all.filter((name) => tables.has(name.match(/^_vers_[1-9]\d*_space_\d+_(.+)$/)?.[1] ?? ""));
}
import type { HealthChecks } from "@qino/qino/cms.backend.system";

export function healthChecks(app: App): HealthChecks {
  return {
    cleanup: {
      "version history": async () => {
        const count = await thinHistory(app.db, true);
        if (!count) return;
        return {
          info: `${count} thinnable entries (scale-invariant decay: fine while fresh, coarser with age)`,
          solutions: {
            "thin out": {
              solve: async () => `${await thinHistory(app.db)} entries deleted`,
            },
          },
        };
      },
      "version views": async () => {
        const stray = await strayViews(app.db);
        if (!stray.length) return;
        return {
          info: `${stray.length} views of old versions nobody reads, from before they were dropped after use`,
          solutions: {
            drop: {
              solve: async () => {
                const views = await strayViews(app.db);
                for (const view of views) await app.db.query`DROP VIEW IF EXISTS ${sql.id(view)}`;
                return `${views.length} views dropped`;
              },
            },
          },
        };
      },
    },
  };
}
