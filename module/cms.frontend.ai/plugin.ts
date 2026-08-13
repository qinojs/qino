import { cmsCtx } from "@qino/qino/cms";
import { ai } from "@qino/qino/ai";

import { cmsHelper } from "./bots/cmsHelper.ts";

import type { App } from "@qino/qino";

export function init(app: App, { signal }: { signal: AbortSignal }) {
  ai(app).registerBot(cmsHelper);

  app.on("cms:page-ready", ({ ctx }) => {
    if (ctx.req.query.cms_noFrontend || !cmsCtx(ctx).editmode) return;
    ctx.res.html.scripts.add(ctx.req.moduleUrl + "cms.frontend.ai/pub/init.mjs");
  }, { signal });
}
