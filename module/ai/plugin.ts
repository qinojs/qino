import dbSchema from "./dbschema.json" with { type: "json" };
import { AiApi } from "./mod.ts";
import type { App, RequestContext } from "../core/mod.ts";
import type {} from "../cms/mod.ts";

export const name = "ai";
export const needs = ["core"];
export { api } from "./apt.ts";
export { dbSchema };

export function init(app: Pick<App, "aptTree" | "on" | "settings"> & { ai?: AiApi }) {
  app.ai = new AiApi(app as App);

  app.on("cms-ready", e => {
    const ctx = e.ctx as RequestContext;
    if (!ctx.cms.editmode) return;
    if (ctx.get.qgCmsNoFrontend) return;
    ctx.html.scripts.add(ctx.sysURL + "ai/pub/chat.js");
    ctx.html.content += `
      <style>
          .cmsChatWrapper {
            position:fixed;
            top:3rem;
            left:3rem;
            z-index:9000;
            background:var(--color-bg);
            color:var(--color-text);
            box-shadow:0 0 1rem rgba(0,0,0,.3);
            font-size:14px;
            display:flex;
            flex-direction:column;
            max-height:70vh;
          }
          .cmsChatWrapper ai-chat {
            height:100%;
          }
      </style>
      <div xonmousedown="event.stopPropagation();">
        <div u2-movable class="cmsChatWrapper qgCMS" style="position:fixed;top:80px;left:16px;">
          <div u2-movable-handler style="background:var(--cms-color); color:#fff; padding:.5rem; cursor:move">CMS Helper</div>
          <ai-chat bot="cms-helper"></ai-chat>
        </div>
      </div>`;
  });
}
