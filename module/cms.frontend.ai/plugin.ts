import type { App } from "../core/mod.ts";
import { cmsCtx } from "../cms/mod.ts";
import { ai } from "../ai/mod.ts";
import { cmsHelper } from "./bots/cmsHelper.ts";

export const name = "cms.frontend.ai";
export const description = "Adds an AI assistant to the in-page CMS editor.";
export const needs = ["cms.frontend.2", "ai"];

export function init(app: App, { signal }: { signal: AbortSignal }) {
  ai(app).registerBot(cmsHelper);

  app.on("cms:page-ready", ({ ctx }) => {
    if (ctx.req.query.cms_noFrontend) return;
    if (!cmsCtx(ctx).editmode) return;
    ctx.res.html.scripts.add(ctx.req.moduleUrl + "cms.frontend.ai/pub/init.mjs");
  }, { signal });
}
