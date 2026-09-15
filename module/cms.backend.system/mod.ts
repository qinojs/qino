// Public API of cms.backend.system: a module contributes checks by exporting
// `healthChecks(app): HealthChecks` from its plugin — the shape is duck-typed, no import needed.
export type { Check, CheckResult, HealthChecks } from "./lib/healthRegistry.ts";
export { findCheck, getHealthChecks } from "./lib/healthRegistry.ts";
export { cap, solutionsHtml } from "./lib/solutions.ts";
export { default as healthApi } from "./nodeApi.ts";
