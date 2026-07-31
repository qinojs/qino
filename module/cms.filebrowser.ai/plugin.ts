import type { App } from "../core/mod.ts";
import { cmsCtx } from "../cms/mod.ts";

export const name = "cms.filebrowser.ai";
export const description = "Adds AI image generation to the CMS file browser.";
export const needs = ["cms", "ai", "cms.filebrowser"];

export function init(app: App, { signal }: { signal: AbortSignal }) {
  app.on("cms:page-ready", ({ ctx }) => {
    if (ctx.req.query.cms_noFrontend) return;
    if (!cmsCtx(ctx).editmode) return;
    const csp = ctx.res.csp;
    csp["img-src"]["https://image.pollinations.ai"] = true;
    ctx.res.html.scripts.add(ctx.req.modulePath + "cms.filebrowser.ai/pub/init.mjs");
  }, { signal });
}
