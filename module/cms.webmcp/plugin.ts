import { Access, type App, type AptTree, type Params, type Ctx } from "../core/mod.ts";
import type {} from "../cms/mod.ts";
import { webmcpTools } from "./mod.ts";

export const name = "cms.webmcp";
export const description = "Exposes accessible application tools to browsers through WebMCP.";
export const needs = ["cms"];

export const api: AptTree = {
  tools: {
    get: {
      description: "List WebMCP tool descriptors for the current app (name, description, inputSchema, method, path).",
      access: Access.PUBLIC,
      execute: (_params: Params, ctx: Ctx) => webmcpTools(ctx.app.aptTree, ctx),
    },
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("cms:page-ready", ({ ctx }) => {
    ctx.res.html.scripts.add(ctx.req.moduleUrl + "cms.webmcp/pub/webmcp.mjs"); // all visitors; tool list is access-filtered, each call enforced
  }, { signal });
}
