import type { App } from "../core/mod.ts";
import type {} from "../cms/mod.ts";

export const name = "cms.filebrowser.ai";
export const needs = ["cms", "ai", "cms.filebrowser"];

export function init(app: App) {
    app.on("cms-ready", ({ ctx }) => {
        if (ctx.get.qgCmsNoFrontend) return;
        if (!ctx.cms.editmode) return;
        const csp = ctx.csp;
        csp["img-src"]["https://image.pollinations.ai"] = true;
        ctx.html.scripts.add(ctx.sysURL + "cms.filebrowser.ai/pub/init.mjs");
    });
}
