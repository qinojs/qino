import type { RequestContext } from "../core/mod.ts";
import type { App } from "../core/mod.ts";

export const name = "cms.filebrowser.pexels";
export const needs = ["cms", "cms.filebrowser"];

export function init(app: App) {
    app.on("cms-ready", e => {
        const ctx = e.ctx as RequestContext;
        if (ctx.get.qgCmsNoFrontend) return;
        if (!ctx.state.editmode) return;
        const csp = ctx.csp;
        csp["connect-src"] ??= {};
        csp["img-src"] ??= {};
        csp["connect-src"]["https://*.pexels.com"] = 1;
        csp["img-src"]["https://*.pexels.com"] = 1;
        ctx.html.scripts.add(ctx.sysURL + "cms.filebrowser.pexels/pub/init.mjs");
    });
}
