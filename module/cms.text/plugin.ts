import type { App } from "../core/mod.ts";
import { cmsCtx } from "../cms/mod.ts";

export const name = "cms.text";
export const description = "Automatic text translation and revision history.";
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

export function init(app: App, { signal }: { signal: AbortSignal }) {
  app.on("cms:page-ready", ({ ctx }) => {
    if (!cmsCtx(ctx).editmode || ctx.req.query.cms_noFrontend) return;
    ctx.res.html.scripts.add(ctx.req.moduleUrl + "cms.text/pub/init.mjs");
  }, { signal });
}

export { api } from "./api.ts";

export function install({ app }: { app: App }): void { // tobi: I do not think this is needed
  app.settings["cms.text"]["translation service"];
}
