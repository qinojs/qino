import { html } from "@qino/qino";
import * as u2 from "@qino/qino/u2";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

async function render(node: Node, {ctx}: { ctx: Ctx }): Promise<HtmlString> {

  const resHtml = ctx.res.html;
  await u2.assets(ctx, ["css/norm/norm.css", "css/base/base.css", "u2/auto.js"]);

  resHtml.styles.add(ctx.req.moduleUrl + "cms/pub/css/ui.css");
  resHtml.scripts.add(ctx.req.moduleUrl + "cms/pub/js/cms.mjs");
  resHtml.class.add("qgCMS");

  const title = await (await node.title()).string();

  return html.async`
  <div id=container>
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
    css: [
      "pub/main.css",
    ],
    render,
  },
};
