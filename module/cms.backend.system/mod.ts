// Public API of cms.backend.system: the health-check contract other modules implement.
// A module contributes checks by exporting `healthChecks(app): HealthTypes` from its plugin.
export type { HealthTypes } from "./lib/healthRegistry.ts";
