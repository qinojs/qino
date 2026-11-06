import { record } from "./history.ts";

import type { App } from "@qino/qino";
import type { Flow } from "../mod.ts";

type Trace = { flow: string; end: string; calls: unknown[]; result?: unknown; state?: Flow["state"]; error?: string };

const listening = new WeakMap<App, Map<number, Flow>>(); // per app, like the history

/** The flows of the table that listen now, by id. */
export const listeners = (app: App): Map<number, Flow> => listening.get(app) ?? listening.set(app, new Map()).get(app)!;

/** Keeps what a run of flow `id` of the table leaves: its trace in the history, a changed state in the
 *  listening flow and in the row. */
export function keep(app: App, id: number, trace: Trace): void {
  record(app, id, trace);
  if (trace.state) {
    const flow = listeners(app).get(id);
    if (flow) flow.state = trace.state;
    app.db.table("flow").update(id, { state: JSON.stringify(trace.state) }).catch(console.error);
  }
  if (trace.end === "error") console.error(`[sandbox.flow] ${trace.flow}:`, trace.error);
}
