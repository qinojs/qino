import { getCtx } from "@qino/qino";

import type { App } from "@qino/qino";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };
export { api } from "./api.ts";

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  // a profile image is for signed-in users; guests need a signed link
  app.on("dbFile:access-fallback", async (e) => {
    if (!getCtx().userId) return;
    if (await app.db.one`SELECT 1 FROM usr WHERE image_id = ${e.file.id}`) e.access = true;
  }, { signal });
}
