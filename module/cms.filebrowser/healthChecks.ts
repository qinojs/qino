import type { HealthTypes } from "@qino/qino/cms.backend.system";
import type { App } from "@qino/qino";

export function healthChecks(app: App): HealthTypes {
  const db = app.db;
  return {
    cleanup: {
      "delete user-files": async () => {
        const d = new Date(); d.setMonth(d.getMonth() - 6); // 6 months ago, dialect-neutral
        const cutoff = d.toISOString().slice(0, 19).replace("T", " ");
        const count = Number(await db.one`SELECT COUNT(*) FROM usr_file WHERE added < ${cutoff}`);
        if (count < 100) return;
        return {
          info: "old user-files " + count,
          solutions: {
            run: {
              solve: async () => {
                const res = await db.exec`DELETE FROM usr_file WHERE added < ${cutoff}`;
                return res.affectedRows + " rows deleted\n";
              },
            },
          },
        };
      },
    },
  };
}
