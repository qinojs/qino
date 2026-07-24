/** True when `cmd` exists and exits 0. A missing binary throws synchronously from `output()`. */
export async function tryCommand(cmd: string, args: string[]): Promise<boolean> {
  try { return (await new Deno.Command(cmd, { args, stdout: 'piped', stderr: 'piped' }).output()).code === 0; }
  catch { return false; }
}

export type Probe = (() => Promise<boolean>) & { reset(): void };

const probes = new Set<Probe>();

/** Cached "is `cmd` available" check. Self-registers for `resetProbes()`, so adding a tool needs no central edit. */
export function probe(cmd: string, args: string[]): Probe {
  let cached: Promise<boolean> | null = null;
  const fn = (() => cached ??= tryCommand(cmd, args)) as Probe;
  fn.reset = () => { cached = null; };
  probes.add(fn);
  return fn;
}

/** Re-probe all capabilities (e.g. after installing a binary at runtime). */
export function resetProbes(): void { for (const p of probes) p.reset(); }
