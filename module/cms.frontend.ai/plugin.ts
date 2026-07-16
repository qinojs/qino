import type { App } from "../core/mod.ts";
import { cmsCtx } from "../cms/mod.ts";
import { ai } from "../ai/mod.ts";
import { CmsHelperBot } from "./bots/cmsHelper.ts";

export const name = "cms.frontend.ai";
export const needs = ["cms.frontend.2", "ai"];

export function init(app: App) {
  ai(app).registerBot(CmsHelperBot);

  app.on("cms-ready", ({ ctx }) => {
    if (ctx.req.query.cms_noFrontend) return;
    if (!cmsCtx(ctx).editmode) return;
    ctx.res.html.scripts.add(ctx.req.modulePath + "cms.frontend.ai/pub/init.mjs");
  });
}
