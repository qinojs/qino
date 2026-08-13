import type { HealthTypes } from "@qino/qino/cms.backend.system";
import { sql, type App } from "@qino/qino";
import { deleteUnlinkedDb } from "./cleanup.ts";

export function healthChecks(app: App): HealthTypes {
  const db = app.db;
  return {
    cleanup: {
      "unused dbFiles": async () => {
        const children = db.table("file").children;
        if (!children.length) return;
        const notLinked = children.map((child) =>
          sql`id NOT IN (SELECT ${sql.id(child.name)} FROM ${sql.id(child.table.name)})`
        );
        const count = Number(await db.one`SELECT count(*) FROM file WHERE ${sql.join(notLinked, " AND ")}`);
        if (!count) return;
        return {
          info: `${count} files (used()-hooks not checked yet)`,
          solutions: {
            "delete unused": {
              solve: async () => `${(await deleteUnlinkedDb(app)).deleted} files deleted`,
            },
          },
        };
      },
    },
  };
}
