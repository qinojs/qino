import type { App, RequestContext } from "../core/mod.ts";
import type {} from "../cms/mod.ts";
import type {} from "../ai/mod.ts";
import { CmsHelperBot } from "./bots/cmsHelper.ts";

export const name = "cms.frontend.ai";
export const needs = ["cms.frontend.2", "ai"];

export function init(app: App) {
  app.ai.registerBot(CmsHelperBot);

  app.on("cms-ready", e => {
    const ctx = e.ctx as RequestContext;
    if (ctx.get.qgCmsNoFrontend) return;
    if (!ctx.cms.editmode) return;
    ctx.html.scripts.add(ctx.sysURL + "cms.frontend.ai/pub/init.mjs");
  });
}
