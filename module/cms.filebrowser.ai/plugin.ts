import type { App } from "../core/mod.ts";
import type {} from "../cms/mod.ts";

export const name = "cms.filebrowser.ai";
export const needs = ["cms", "ai", "cms.filebrowser"];

export function init(app: App) {
  app.on("cms-ready", ({ ctx }) => {
    if (ctx.req.query.cms_noFrontend) return;
    if (!ctx.cms.editmode) return;
    const csp = ctx.res.csp;
    csp["img-src"]["https://image.pollinations.ai"] = true;
    ctx.res.html.scripts.add(ctx.req.modulePath + "cms.filebrowser.ai/pub/init.mjs");
  });
}
