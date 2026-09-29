import { cmsCtx } from "@qino/qino/cms";

import type { App } from "@qino/qino";

/** The text editor's assistant, in editmode. */
export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.on("cms:page-ready", ({ ctx }) => {
    if (ctx.req.query.cms_noFrontend || !cmsCtx(ctx).editmode) return;
    ctx.res.html.scripts.add(ctx.req.moduleUrl + "cms.frontend.ai1/pub/rte.js");
    ctx.res.csp["script-src"]["https://cdn.jsdelivr.net/npm/htmldiff-js@1.0.5/+esm"] = true; // the diff pane, loaded on first use
  }, { signal });
}
