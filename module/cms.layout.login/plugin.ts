import type { Node } from "../cms/mod.ts";
import { html, u2Root, type Ctx, type HtmlString } from "../core/mod.ts";

async function render(node: Node, {ctx}: { ctx: Ctx }): Promise<HtmlString> {

  const resHtml = ctx.res.html;
  resHtml.styles.add(u2Root + "css/norm/norm.css");
  resHtml.styles.add(u2Root + "css/base/base.css");
  resHtml.scripts.add(u2Root + "u2/auto.js");

  resHtml.styles.add(ctx.req.moduleUrl + "cms/pub/css/ui.css");
  resHtml.legacyScripts.add(ctx.req.moduleUrl + "core/pub/js/c1.js");
  resHtml.scripts.add(ctx.req.moduleUrl + "cms/pub/js/cms.mjs");

  const title = await (await node.title()).string();

  return html.async`
  <div id=container class=qgCMS>
    <div id=head>
      <div id=title>${title}</div>
      <div id=subtitle>${ctx.req.header("host")}</div>
    </div>
    <div id=content>
      ${node.cont("main")}
    </div>
  </div>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    render,
  },
};
