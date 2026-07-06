// deno-lint-ignore-file no-explicit-any

export type Solution = {
  form?: Record<string, Record<string, unknown>>;
  solve: (formData?: Record<string, unknown>) => Promise<unknown> | unknown;
};

export type CheckResult = {
  info?: string;
  solutions?: Record<string, Solution>;
} | undefined;

export type CheckFn = { (): Promise<CheckResult> | CheckResult; mod?: string };

export type HealthTypes = Record<string, Record<string, CheckFn>>;

export async function getHealthTypes(app: any): Promise<HealthTypes> {
  const types: HealthTypes = {
    error:   {},
    warning: {},
    notice:  {},
    cleanup: {},
    repair:  {},
  };

  for (const mod of Object.values(app.modules.all()) as any[]) {
    const hc = mod.plugin.healthChecks;
    if (!hc) continue;
    const checks = await hc(app);
    for (const [type, items] of Object.entries(checks) as any[]) {
      for (const [key, item] of Object.entries(items) as any[]) {
        (types[type] ??= {})[key] = item;
        if (item) item.mod = mod.name;
      }
    }
  }

  return types;
}
