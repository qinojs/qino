// deno-lint-ignore-file no-explicit-any
import type { HealthTypes } from "../cms.backend.system/healthRegistry.ts";
import { sql, unixTime } from "../core/mod.ts";

export const healthChecks = {
  get(app: any): HealthTypes {
    const db = app.db;
    return {
      cleanup: {
        "unused dbFiles": async () => {
          const children = db.table("file").children;
          if (!children.length) return undefined;
          const notLinked = children.map((F: any) =>
            sql`id NOT IN (SELECT ${sql.id(F.name)} FROM ${sql.id(F.table.name)})`
          );
          const count = Number(await db.one`SELECT count(*) FROM file WHERE ${sql.join(notLinked, " AND ")}`);
          if (!count) return undefined;
          return {
            info: `${count} files (used()-hooks not checked yet)`,
            solutions: {
              "delete unused": {
                solve: async () => {
                  const fm = app.dbFiles;
                  const ago = unixTime() - 60 * 60 * 24 * 7;
                  const notLinkedFull = children.map((F: any) =>
                    sql`file.id NOT IN (SELECT ${sql.id(F.name)} FROM ${sql.id(F.table.name)})`
                  );
                  const rows = await db.query`SELECT file.id FROM file
                    LEFT JOIN log log_i ON file.log_id=log_i.id
                    LEFT JOIN log log_e ON file.log_id_ch=log_e.id
                    WHERE log_i.time<${ago} AND log_e.time<${ago}
                    AND ${sql.join(notLinkedFull, " AND ")}`;
                  let deleted = 0;
                  for (const row of rows) {
                    const f = await fm.file(row.id);
                    if (!await f.used() && !await f.access()) { await f.remove(); deleted++; }
                  }
                  return `${deleted} files deleted`;
                },
              },
            },
          };
        },
      },
    };
  },
};
