// deno-lint-ignore-file no-explicit-any

export const name = "cms.filebrowser.ai";
export const needs = ["cms", "ai"];

export function init(app: any) {
    app.on("cms-ready", ({ ctx }: any) => {
        if (ctx.get.qgCmsNoFrontend) return;
        if (!ctx.state.editmode) return;
        const csp = ctx.csp;
        csp["img-src"] ??= {};
        csp["img-src"]["https://image.pollinations.ai"] = true;
        ctx.html.addJSM(ctx.sysURL + "cms.filebrowser.ai/pub/init.mjs");
    });
}
