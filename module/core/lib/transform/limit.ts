/** Caps concurrent external processes. CPU the scheduler shares by itself, but memory it does not:
 *  decoders hold their peak at the same time, and the OS answer to that is the OOM killer.
 *  Waiting, never rejecting — the work is queued, not dropped. */
let running = 0;
const waiting: (() => void)[] = [];

export let maxProcesses: number = navigator.hardwareConcurrency || 4;

export function setMaxProcesses(n: number): void { maxProcesses = Math.max(1, n); }

export async function limited<T>(run: () => Promise<T>): Promise<T> {
  if (running >= maxProcesses) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try { return await run(); } finally { running--; waiting.shift()?.(); }
}
