import type { App } from "@qino/qino";
import { cmsCtx } from "@qino/qino/cms";

export function init(app: App, { signal }: { signal: AbortSignal }) {
  app.on("cms:page-ready", ({ ctx }) => {
    if (ctx.req.query.cms_noFrontend || !cmsCtx(ctx).editmode) return;
    const csp = ctx.res.csp;
    csp["img-src"]["https://image.pollinations.ai"] = true;
    ctx.res.html.scripts.add(ctx.req.moduleUrl + "cms.filebrowser.ai/pub/init.mjs");
  }, { signal });
}
