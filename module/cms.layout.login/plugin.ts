import type { Node } from "../cms/mod.ts";
import { html, type Ctx, type HtmlString } from "../core/mod.ts";
import * as u2 from "../u2/mod.ts";

async function render(node: Node, {ctx}: { ctx: Ctx }): Promise<HtmlString> {

  const resHtml = ctx.res.html;
  await u2.assets(ctx, ["css/norm/norm.css", "css/base/base.css", "u2/auto.js"]);

  resHtml.styles.add(ctx.req.moduleUrl + "cms/pub/css/ui.css");
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
