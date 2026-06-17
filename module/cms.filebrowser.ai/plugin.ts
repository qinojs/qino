// deno-lint-ignore-file no-explicit-any

export const name = "cms.filebrowser.ai";
export const needs = ["cms", "ai", "cms.filebrowser"];

export function init(app: any) {
    app.on("cms-ready", ({ ctx }: any) => {
        if (ctx.get.qgCmsNoFrontend) return;
        if (!ctx.cms.editmode) return;
        const csp = ctx.csp;
        csp["img-src"]["https://image.pollinations.ai"] = true;
        ctx.html.scripts.add(ctx.sysURL + "cms.filebrowser.ai/pub/init.mjs");
    });
}
