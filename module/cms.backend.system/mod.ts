// Public API of cms.backend.system: a module contributes checks by exporting
// `healthChecks(app): HealthTypes` from its plugin — the shape is duck-typed, no import needed.
export type { HealthTypes } from "./lib/healthRegistry.ts";
