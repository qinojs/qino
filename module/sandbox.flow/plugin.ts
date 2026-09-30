import { listen } from "./mod.ts";
import { record } from "./lib/history.ts";
import { toFlow } from "./lib/row.ts";

import type { App } from "@qino/qino";

export { api } from "./api.ts";
export { default as dbSchema } from "./dbschema.json" with { type: "json" };

/** Listens with every active flow of the table; a changed row is listened to anew. */
export async function init(app: App, { signal }: { signal: AbortSignal }): Promise<void> {
  const flows = new Map<number, AbortController>();
  // one after the other: two quick changes must not both listen, one of them lost to abort
  let queue = Promise.resolve();
  const load = (id: number) => queue = queue.then(() => listenTo(id), console.error);
  const listenTo = async (id: number) => {
    flows.get(id)?.abort();
    flows.delete(id);
    const row = await app.db.row`SELECT * FROM flow WHERE id = ${id}`;
    if (!row?.active) return;
    const stop = new AbortController();
    try {
      const flow = toFlow(row);
      listen(app, flow, { signal: AbortSignal.any([signal, stop.signal]), report: (trace) => {
        record(app, id, trace);
        if (trace.end === "error") console.error(`[sandbox.flow] ${trace.flow}:`, trace.steps.at(-1)?.error);
      } });
      flows.set(id, stop);
    } catch (e) {
      console.error(`[sandbox.flow] flow ${id}:`, e); // a broken row must not keep the others from listening
    }
  };
  for (const id of await app.db.col`SELECT id FROM flow WHERE active = ${true}`) await load(Number(id));
  for (const event of ["table:insert-after", "table:update-after", "table:delete-after"] as const) {
    app.db.on(event, ({ table, id }) => String(table) === "flow" ? load(Number(id)) : undefined, { signal });
  }
}
