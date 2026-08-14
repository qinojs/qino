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

export type CheckFn = { (): Promise<CheckResult> | CheckResult; mod?: string };

/** Checks grouped by severity: error, warning, notice, cleanup, repair. */
export type HealthChecks = Record<string, Record<string, CheckFn>>;

/** Collects the healthChecks hook of every linked module, tagging each check with its module name. */
export async function getHealthChecks(app: App): Promise<HealthChecks> {
  const types: HealthChecks = {
    error:   {},
    warning: {},
    notice:  {},
    cleanup: {},
    repair:  {},
  };

  for (const mod of Object.values(app.modules.all())) {
    const hc = mod.plugin.healthChecks;
    if (!hc) continue;
    const checks: HealthChecks = await hc(app);
    for (const [type, items] of Object.entries(checks)) {
      for (const [key, item] of Object.entries(items)) {
        (types[type] ??= {})[key] = item;
        if (item) item.mod = mod.name;
      }
    }
  }

  return types;
}
