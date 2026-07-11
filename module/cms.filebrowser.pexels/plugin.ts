import type { App } from "../core/mod.ts";
import type {} from "../cms/mod.ts";

export const name = "cms.filebrowser.pexels";
export const needs = ["cms", "cms.filebrowser"];

export function init(app: App) {
  app.on("cms-ready", ({ ctx }) => {
    if (ctx.req.query.cms_noFrontend) return;
    if (!ctx.cms.editmode) return;
    const csp = ctx.res.csp;
    csp["connect-src"]["https://*.pexels.com"] = true;
    csp["img-src"]["https://*.pexels.com"] = true;
    ctx.res.html.scripts.add(ctx.req.modulePath + "cms.filebrowser.pexels/pub/init.mjs");
  });
}
