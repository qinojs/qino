import { hee } from "@qino/qino";

import type { App } from "@qino/qino";
import { liveInstances } from "./lib/instanceMarker.ts";

import type { HealthChecks } from "./lib/healthRegistry.ts";

export function healthChecks(app: App): HealthChecks {
  return {
    error: {
      // Nothing separates the instances below dir, so they overwrite each other's module files.
      "dir shared with another instance": async () => {
        const n = await liveInstances(app.dir);
        if (n < 2) return;
        return { info: `${n} instances use ${hee(app.dir)} — give each its own dir, or they share data/, cache/ and tmp/` };
      },
    },
  };
}
