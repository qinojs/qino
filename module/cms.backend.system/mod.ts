// Modules add checks by exporting `healthChecks(app): HealthChecks` from their plugin (duck-typed, no import).
export type { Check, CheckResult, HealthChecks } from "./lib/healthRegistry.ts";
export { findCheck, getHealthChecks } from "./lib/healthRegistry.ts";
export { cap, solutionsHtml } from "./lib/solutions.ts";
export { default as healthApi } from "./nodeApi.ts";
