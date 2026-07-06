import type { HealthTypes } from "../cms.backend.system/healthRegistry.ts";
import type { App } from "../core/mod.ts";
import { thinHistory } from "./maintenance.ts";

export function healthChecks(app: App): HealthTypes {
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
