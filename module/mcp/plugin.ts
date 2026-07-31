import type { App } from "../core/mod.ts";
import { mcpFetch } from "./mod.ts";

export const name = "mcp";
export const description = "Exposes the application Apt API through an MCP endpoint.";
export const needs = ["core"];

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("route", async ({ ctx }) => {
    if (ctx.req.appPath !== "mcp") return;
    await mcpFetch(ctx);
  }, { signal });
}
