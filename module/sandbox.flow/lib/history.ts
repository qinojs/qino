import type { App } from "@qino/qino";

type Trace = { end: string; steps: unknown[] };
type Kept = { runs: (Trace & { time: Date })[]; filtered: number };

const KEEP = 20;
const kept = new WeakMap<App, Map<number, Kept>>(); // per app: runs live in memory, like the flows

/** Keep a run of flow `id`: the latest KEEP, newest first. One that stopped at its first step (the
 *  event was not for it) is only counted, else a busy event would push the others out. */
export function record(app: App, id: number, trace: Trace): void {
  const flows = kept.get(app) ?? kept.set(app, new Map()).get(app)!;
  const flow = flows.get(id) ?? flows.set(id, { runs: [], filtered: 0 }).get(id)!;
  if (trace.end === "stopped" && trace.steps.length === 1) return void flow.filtered++;
  flow.runs.unshift({ ...trace, time: new Date() });
  flow.runs.length = Math.min(flow.runs.length, KEEP);
}

/** The runs kept of flow `id`, and how many were filtered out, since the process started. */
export const history = (app: App, id: number): Kept => kept.get(app)?.get(id) ?? { runs: [], filtered: 0 };
