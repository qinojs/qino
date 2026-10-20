import { adopt } from "./mod.ts";

import type { App, Row } from "@qino/qino";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };
export { api } from "./api.ts";

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  // a subscription named after a domain is for it: no domain to enter, no link to set by hand
  app.on("subscription:save", ({ subscription }: { subscription: Row }) =>
    adopt(app, subscription).then(() => {}, (e) => console.error("fin.hosting: subscription not linked", e)), { signal });
}
