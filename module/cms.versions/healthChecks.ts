import { thinHistory } from "./maintenance.ts";

import type { App } from "@qino/qino";
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
    },
  };
}
