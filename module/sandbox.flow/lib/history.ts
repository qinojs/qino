import type { App } from "@qino/qino";

type Trace = { end: string; calls: unknown[]; result?: unknown; state?: unknown };
type Kept = { runs: (Trace & { time: Date })[]; filtered: number };

const KEEP = 20;
const kept = new WeakMap<App, Map<number, Kept>>(); // per app: runs live in memory, like the flows

/** Keep a run of flow `id`: the latest KEEP, newest first. One that ended without a tool call, a result
 *  or a changed state (the event was not for it) is only counted, else a busy event would push the others out. */
export function record(app: App, id: number, trace: Trace): void {
  const flows = kept.get(app) ?? kept.set(app, new Map()).get(app)!;
  const flow = flows.get(id) ?? flows.set(id, { runs: [], filtered: 0 }).get(id)!;
  if (trace.end === "done" && !trace.calls.length && !trace.result && !trace.state) return void flow.filtered++;
  flow.runs.unshift({ ...trace, time: new Date() });
  flow.runs.length = Math.min(flow.runs.length, KEEP);
}

/** The runs kept of flow `id`, and how many were filtered out, since the process started. */
export const history = (app: App, id: number): Kept => kept.get(app)?.get(id) ?? { runs: [], filtered: 0 };
