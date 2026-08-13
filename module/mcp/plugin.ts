import { mcpFetch } from "./mod.ts";

import type { App } from "@qino/qino";

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("route", async ({ ctx }) => {
    if (ctx.req.appPath !== "mcp") return;
    await mcpFetch(ctx);
  }, { signal });
}
