import { cmsCtx } from "@qino/qino/cms";
import { ai } from "@qino/qino/ai";

import { cmsHelper } from "./bots/cmsHelper.ts";
import { textEditor } from "./bots/textEditor.ts";

import type { App } from "@qino/qino";

export function init(app: App, { signal }: { signal: AbortSignal }) {
  ai(app).registerBot(cmsHelper);
  ai(app).registerBot(textEditor);

  app.on("cms:page-ready", ({ ctx }) => {
    if (ctx.req.query.cms_noFrontend || !cmsCtx(ctx).editmode) return;
    ctx.res.html.scripts.add(ctx.req.moduleUrl + "cms.frontend.ai/pub/init.mjs");
    // the two libs chat.js imports — self-contained bundles, so the exact urls are enough
    ctx.res.csp["script-src"]["https://cdn.jsdelivr.net/npm/marked@18/+esm"] = true;
    ctx.res.csp["script-src"]["https://cdn.jsdelivr.net/npm/dompurify@3/+esm"] = true;
    ctx.res.csp["script-src"]["https://cdn.jsdelivr.net/npm/htmldiff-js@1.0.5/+esm"] = true; // the assistant's diff pane, loaded on first use
  }, { signal });
}
