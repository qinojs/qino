/** Limits concurrent external processes — for memory, not CPU: parallel decoders peak together and
 *  the OS would kill them. Excess work is queued, never rejected. */
let running = 0;
const waiting: (() => void)[] = [];

export let maxProcesses: number = navigator.hardwareConcurrency || 4;

export function setMaxProcesses(n: number): void { maxProcesses = Math.max(1, n); }

export async function limited<T>(run: () => Promise<T>): Promise<T> {
  if (running >= maxProcesses) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try { return await run(); } finally { running--; waiting.shift()?.(); }
}
