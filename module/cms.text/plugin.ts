import { cmsCtx } from "@qino/qino/cms";

import type { App } from "@qino/qino";

export function init(app: App, { signal }: { signal: AbortSignal }) {
  app.on("cms:page-ready", ({ ctx }) => {
    if (!cmsCtx(ctx).editmode || ctx.req.query.cms_noFrontend) return;
    ctx.res.html.scripts.add(ctx.req.moduleUrl + "cms.text/pub/init.mjs");
  }, { signal });
}

export { api } from "./api.ts";

