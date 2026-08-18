import { mcpFetch } from "./mod.ts";

import type { App } from "@qino/qino";

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("route", ({ ctx }) => ctx.req.appPath === "mcp" ? mcpFetch(ctx) : undefined, { signal });
}
