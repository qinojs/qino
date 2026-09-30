import { cms, cmsCtx } from "@qino/qino/cms";

import type { App } from "@qino/qino";

export function init(app: App, { signal }: { signal: AbortSignal }) {
  cms(app).on("page:render-after", ({ ctx }) => {
    if (!cmsCtx(ctx).editmode || ctx.req.query.cms_noFrontend) return;
    ctx.res.html.scripts.add(ctx.req.moduleUrl + "cms.text/pub/init.mjs");
  }, { signal });
}

export { api } from "./api.ts";

