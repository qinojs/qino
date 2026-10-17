import { observed } from "@qino/qino/iot";

import { sourced, view } from "./mod.ts";

import type { App } from "@qino/qino";

export { api } from "./api.ts";
export { iotProvider } from "./mod.ts";
export { default as dbSchema } from "./dbschema.json" with { type: "json" };

/** A source's observations and changes are the virtual entity's: recording, values and flows see them as usual. */
export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("iot:observe", async ({ provider, id, entity, time }) => {
    for (const row of await sourced(app, provider, id)) {
      await observed(app, row.provider, String(row.id), view(row, entity), time);
    }
  }, { signal });
  // Reports pass on as they are: the virtual entity has the source's values, so the same paths changed.
  for (const name of ["iot:input", "iot:change"]) {
    app.on(name, async ({ provider, id, entity, previous, changed }) => {
      for (const row of await sourced(app, provider, id)) {
        const now = view(row, entity), before = view(row, previous);
        await app.fire(name, { provider: row.provider, id: String(row.id), entity: now, previous: before, changed });
      }
    }, { signal });
  }
}
