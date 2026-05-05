// Port of cms.filebrowser.pexels/qg.php

import type { App } from "../core/server.ts";

export const name = "cms.filebrowser.pexels";
export const needs = ["cms"];

export function init(app: App) {
    app.on("cms-ready", ({ ctx }) => {
        if (ctx.get.qgCmsNoFrontend) return;
        if (!ctx.state.editmode) return;
        const csp = ctx.csp;
        csp["connect-src"] ??= {};
        csp["img-src"] ??= {};
        csp["connect-src"]["https://*.pexels.com"] = true;
        csp["img-src"]["https://*.pexels.com"] = true;
        ctx.html.addJSM(ctx.sysURL + "cms.filebrowser.pexels/pub/init.mjs");
    });
}
