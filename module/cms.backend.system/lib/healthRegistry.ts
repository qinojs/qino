import type { App } from "@qino/qino";

/** One offered fix for a failed check; `form` describes optional inputs passed to `solve`. */
export type Solution = {
  form?: Record<string, Record<string, unknown>>;
  solve: (formData?: Record<string, unknown>) => Promise<unknown> | unknown;
};

/** Undefined = the check passed. */
export type CheckResult = {
  info?: string;
  solutions?: Record<string, Solution>;
} | undefined;

export type CheckFn = () => Promise<CheckResult> | CheckResult;

/** What a module exports: its checks grouped by severity — error, warning, notice, cleanup, repair. */
export type HealthChecks = Record<string, Record<string, CheckFn>>;
/** The collected registry: severity, then module name, then check. A check is addressed by all three. */
export type HealthRegistry = Record<string, Record<string, Record<string, CheckFn>>>;

/** Collects the healthChecks hook of every linked module under its module name. */
export async function getHealthChecks(app: App): Promise<HealthRegistry> {
  const types: HealthRegistry = { error: {}, warning: {}, notice: {}, cleanup: {}, repair: {} };
  for (const mod of app.modules.linked()) {
    const checks: HealthChecks | undefined = await mod.plugin.healthChecks?.(app);
    for (const [type, items] of Object.entries(checks ?? {})) (types[type] ??= {})[mod.name] = items;
  }
  return types;
}
