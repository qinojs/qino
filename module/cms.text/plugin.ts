import type { App, RequestContext } from "../core/mod.ts";
import type {} from "../cms/mod.ts";

export const name = "cms.text";
export const needs = ["cms"];

export const settingsSchema = {
    properties: {
        "translation service": {
            type: "string",
            enum: ["", "google", "deepl"],
            description: "Which translation service is used for automatic translations",
        },
        deepl: {
            properties: {
                key: {
                    type: "string",
                    description: "API key for DeepL",
                },
            },
        },
        google: {
            properties: {
                key: {
                    type: "string",
                    description: "API key for Google Translate",
                },
            },
        },
        "translate char count": {
            type: "integer",
            description: "Counter for automatically translated characters",
        },
    },
};

export function init(app: App) {
    app.on("cms-ready", e => {
        const ctx = e.ctx as RequestContext;
        if (!ctx.cms.editmode) return;
        if (ctx.get.qgCmsNoFrontend) return;
        ctx.html.scripts.add(ctx.sysURL + "cms.text/pub/init.mjs");
    });
}

export { api } from "./api.ts";

export function install({ app }: { app: App }): void {
    app.settings["cms.text"]["translation service"];
}
