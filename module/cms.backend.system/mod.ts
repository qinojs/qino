// Public API of cms.backend.system: a module contributes checks by exporting
// `healthChecks(app): HealthChecks` from its plugin — the shape is duck-typed, no import needed.
export type { HealthChecks } from "./lib/healthRegistry.ts";
