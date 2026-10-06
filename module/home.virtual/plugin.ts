import { observed } from "@qino/qino/home";

import { sourced, view } from "./mod.ts";

import type { App } from "@qino/qino";

export { api } from "./api.ts";
export { homeProvider } from "./mod.ts";
export { default as dbSchema } from "./dbschema.json" with { type: "json" };

/** A source's observations and changes are the virtual entity's: recording, values and flows see them as usual. */
export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("home:observe", async ({ provider, id, entity, time }) => {
    for (const row of await sourced(app, provider, id)) {
      await observed(app, row.provider, String(row.id), view(row, entity), time);
    }
  }, { signal });
  // changed() would observe a second time: the source's observation already arrived above.
  app.on("home:change", async ({ provider, id, entity, previous }) => {
    for (const row of await sourced(app, provider, id)) {
      const [now, before] = [view(row, entity), view(row, previous)];
      await app.fire("home:change", { provider: row.provider, id: String(row.id), entity: now, previous: before });
    }
  }, { signal });
}
