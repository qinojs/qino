import { sys } from "../sys.ts";

/** True when `cmd` exists and exits 0. */
export function tryCommand(cmd: string, args: string[]): Promise<boolean> {
  return sys.command(cmd, { args, stdout: 'piped', stderr: 'piped' }).then((r) => r.success, () => false);
}

export type Probe = (() => Promise<boolean>) & { reset(): void };

const probes = new Set<Probe>();

/** Cached "is `cmd` available" check; registers itself for `resetProbes()`. */
export function probe(cmd: string, args: string[]): Probe {
  let cached: Promise<boolean> | null = null;
  const fn = (() => cached ??= tryCommand(cmd, args)) as Probe;
  fn.reset = () => { cached = null; };
  probes.add(fn);
  return fn;
}

/** Re-probe all capabilities (e.g. after installing a binary at runtime). */
export function resetProbes(): void { for (const p of probes) p.reset(); }
