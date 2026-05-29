// deno-lint-ignore-file no-explicit-any
import type { HealthTypes } from "../cms.backend.system/health_check.ts";
import { Db } from "../core/lib/Db.ts";

export const healthChecks = {
  get(app: any): HealthTypes {
    const db = app.db;
    return {
      cleanup: {
        "unused dbFiles": async () => {
          const children = db.table("file").children;
          if (!children.length) return undefined;
          const notLinked = children.map((F: any) =>
            `id NOT IN (SELECT ${Db.escapeId(F.name)} FROM ${Db.escapeId(F.table.name)})`
          );
          const count = Number(await db.one(
            `SELECT count(*) FROM file WHERE ${notLinked.join(" AND ")}`
          ));
          if (!count) return undefined;
          return {
            info: `${count} files (used()-hooks not checked yet)`,
            solutions: {
              "delete unused": {
                solve: async () => {
                  const fm = app.dbFiles;
                  const ago = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 7;
                  const notLinkedFull = children.map((F: any) =>
                    `file.id NOT IN (SELECT ${Db.escapeId(F.name)} FROM ${Db.escapeId(F.table.name)})`
                  );
                  const rows = await db.all(`SELECT file.id FROM file
                    LEFT JOIN log log_i ON file.log_id=log_i.id
                    LEFT JOIN log log_e ON file.log_id_ch=log_e.id
                    WHERE log_i.time<${ago} AND log_e.time<${ago}
                    AND ${notLinkedFull.join(" AND ")}`);
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
