import { Access } from "@qino/qino";
import { cms } from "@qino/qino/cms";

import { webmcpTools } from "./mod.ts";

import type { App, ApiTree, Params, Ctx } from "@qino/qino";
import type {} from "@qino/qino/cms";

export const api: ApiTree = {
  tools: {
    get: {
      description: "List WebMCP tool descriptors for the current app (name, description, inputSchema, method, path).",
      access: Access.PUBLIC,
      execute: (_params: Params, ctx: Ctx) => webmcpTools(ctx.app.apiTree, ctx),
    },
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  cms(app).on("page:render-after", ({ ctx }) => {
    ctx.res.html.scripts.add(ctx.req.moduleUrl + "cms.webmcp/pub/webmcp.mjs"); // all visitors; tool list is access-filtered, each call enforced
  }, { signal });
}
