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

/** What a module exports: its checks grouped by severity. */
export type HealthChecks = Record<string, Record<string, CheckFn>>;

/** One registered check. `type` and `mod` and `name` together address it; `rank` sorts by severity. */
export type Check = { type: string; rank: number; mod: string; name: string; run: CheckFn };

const SEVERITY = ["error", "warning", "notice", "cleanup", "repair"];

/** The checks of every linked module, flat and sorted by severity. */
export async function getHealthChecks(app: App): Promise<Check[]> {
  const all: Check[] = [];
  for (const mod of app.modules.linked()) {
    const checks: HealthChecks | undefined = await mod.plugin.healthChecks?.(app);
    for (const [type, items] of Object.entries(checks ?? {}))
      for (const [name, run] of Object.entries(items)) all.push({ type, rank: SEVERITY.indexOf(type), mod: mod.name, name, run });
  }
  return all.sort((a, b) => a.rank - b.rank);
}

/** Finds the check a client refers to by its `type`/`mod`/`name` triple. */
export const findCheck = (checks: Check[], v: Record<string, unknown>): Check | undefined =>
  checks.find((c) => c.type === v.type && c.mod === v.mod && c.name === v.name);
