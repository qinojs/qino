import { unixTime } from "@qino/qino";

import type { App } from "@qino/qino";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("ai1:call", async (call) => {
    if (!call.error) return;
    await app.db.table("ai1_call_error").insert({
      model_provider_id: call.id, capability: call.capability, time: unixTime(), message: call.error,
    });
  }, { signal });
}
