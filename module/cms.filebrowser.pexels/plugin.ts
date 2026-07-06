import type { App } from "../core/mod.ts";
import type {} from "../cms/mod.ts";

export const name = "cms.filebrowser.pexels";
export const needs = ["cms", "cms.filebrowser"];

export function init(app: App) {
  app.on("cms-ready", ({ ctx }) => {
    if (ctx.get.cms_noFrontend) return;
    if (!ctx.cms.editmode) return;
    const csp = ctx.csp;
    csp["connect-src"]["https://*.pexels.com"] = true;
    csp["img-src"]["https://*.pexels.com"] = true;
    ctx.html.scripts.add(ctx.sysURL + "cms.filebrowser.pexels/pub/init.mjs");
  });
}
