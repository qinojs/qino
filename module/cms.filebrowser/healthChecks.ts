// deno-lint-ignore-file no-explicit-any
import type { HealthTypes } from "../cms.backend.system/healthRegistry.ts";

export const healthChecks = {
  get(app: any): HealthTypes {
    const db = app.db;
    return {
      cleanup: {
        "delete user-files": async () => {
          const count = Number(await db.one(
            "SELECT COUNT(*) FROM usr_file WHERE added < DATE_SUB(NOW(), INTERVAL 6 MONTH)"
          ));
          if (count < 100) return undefined;
          return {
            info: "old user-files " + count,
            solutions: {
              run: {
                solve: async () => {
                  const res = await db.exec(
                    "DELETE FROM usr_file WHERE added < DATE_SUB(NOW(), INTERVAL 6 MONTH)"
                  );
                  return res.affectedRows + " rows deleted\n";
                },
              },
            },
          };
        },
      },
    };
  },
};
