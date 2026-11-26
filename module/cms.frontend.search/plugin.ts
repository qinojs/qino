import { Access, s } from "@qino/qino";
import { cms, cmsCtx } from "@qino/qino/cms";

import { allowed, search } from "./search.ts";

import type { ApiTree, App, Ctx } from "@qino/qino";

export const api: ApiTree = {
  search: {
    get: {
      description: "Search CMS nodes, their module names, files and users within the administrator's access.",
      access: Access.USER,
      query: s.object({ pid: s.number(), search: s.string() }),
      guard: ({ pid }, ctx) => allowed(ctx, Number(pid)),
      execute: ({ search: query }: { search: string }, ctx: Ctx) => {
        cmsCtx(ctx).editmode = 1;
        return search(ctx, query);
      },
    },
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  cms(app).on("page:render-after", ({ ctx }) => {
    if (!ctx.res.html.scripts.has(ctx.req.moduleUrl + "cms.frontend/pub/panel/panel.js")) return;
    const node = cmsCtx(ctx).mainNode;
    if (node) return allowed(ctx, node.id).then((ok) => { if (ok) ctx.res.html.scripts.add(ctx.req.moduleUrl + "cms.frontend.search/pub/init.js"); });
  }, { signal });
}
