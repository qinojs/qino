import { cmsCtx } from "@qino/qino/cms";

import type { App } from "@qino/qino";

export const settingsSchema = {
  properties: {
    "translation service": {
      type: "string",
      enum: ["", "google", "deepl"],
      description: "Which translation service is used for automatic translations",
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
