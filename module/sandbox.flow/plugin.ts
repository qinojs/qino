import { listen } from "./mod.ts";
import { keep, listeners } from "./lib/table.ts";
import { toFlow } from "./lib/row.ts";

import type { App } from "@qino/qino";

export { api } from "./api.ts";
export { default as dbSchema } from "./dbschema.json" with { type: "json" };

/** Whether a write only kept a flow's state: the listening flow has it already. */
const stateOnly = (data?: Record<string, unknown>) =>
  !!data && "state" in data && Object.keys(data).every((key) => key === "state" || key === "log_id");

/** Listens with every active flow of the table; a changed row is listened to anew. */
export async function init(app: App, { signal }: { signal: AbortSignal }): Promise<void> {
  const flows = new Map<number, AbortController>();
  // one after the other: two quick changes must not both listen, one of them lost to abort
  let queue = Promise.resolve();
  const load = (id: number) => queue = queue.then(() => listenTo(id), console.error);
  const listenTo = async (id: number) => {
    flows.get(id)?.abort();
    flows.delete(id);
    listeners(app).delete(id);
    const row = await app.db.row`SELECT * FROM flow WHERE id = ${id}`;
    if (!row?.active) return;
    const stop = new AbortController();
    try {
      const flow = toFlow(row);
      listen(app, flow, { signal: AbortSignal.any([signal, stop.signal]), report: (trace) => keep(app, id, trace) });
      flows.set(id, stop);
      listeners(app).set(id, flow);
    } catch (e) {
      console.error(`[sandbox.flow] flow ${id}:`, e); // a broken row must not keep the others from listening
    }
  };
  for (const id of await app.db.col`SELECT id FROM flow WHERE active = ${true}`) await load(Number(id));
  const changed = ({ table, id, data }: { table: unknown; id: unknown; data?: Record<string, unknown> }) =>
    String(table) === "flow" && !stateOnly(data) ? load(Number(id)) : undefined;
  for (const event of ["table:insert-after", "table:update-after", "table:delete-after"] as const) {
    app.db.on(event, changed, { signal });
  }
}
