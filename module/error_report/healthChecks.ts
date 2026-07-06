// deno-lint-ignore-file no-explicit-any
import type { HealthTypes } from "../cms.backend.system/healthRegistry.ts";

export function healthChecks(app: any): HealthTypes {
  const db = app.db;
  return {
    cleanup: {
      "clean errors": async () => {
        const num = Number(await db.one`SELECT count(*) FROM m_error_report`);
        if (!num) return undefined;
        return {
          info: num + " errors",
          solutions: {
            "remove all": {
              solve: async () => { await db.query`DELETE FROM m_error_report`; },
            },
            "remove 404": {
              solve: async () => { await db.query`DELETE FROM m_error_report WHERE source = '404'`; },
            },
            "remove bots": {
              solve: async () => { await db.query`DELETE FROM m_error_report WHERE bot`; },
            },
            "remove notices": {
              solve: async () => { await db.query`DELETE FROM m_error_report WHERE prio = 'notice'`; },
            },
          },
        };
      },
    },
  };
}
