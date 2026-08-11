import type { App } from "../core/mod.ts";
import { mcpFetch } from "./mod.ts";

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("route", async ({ ctx }) => {
    if (ctx.req.appPath !== "mcp") return;
    await mcpFetch(ctx);
  }, { signal });
}
