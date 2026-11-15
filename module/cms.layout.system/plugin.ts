import { html } from "@qino/qino";
import * as u2 from "@qino/qino/u2";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** Centered box with the page title, in the shared CMS look (ui.css). */
async function render(node: Node, { ctx }: { ctx: Ctx }) {

  const resHtml = ctx.res.html;
  u2.assets(ctx, ["css/norm/norm.css", "css/base/base.css", "u2/auto.js"]);

  resHtml.styles.add(ctx.req.moduleUrl + "cms/pub/css/ui.css");
  resHtml.scripts.add(ctx.req.moduleUrl + "cms/pub/js/cms.mjs");
  resHtml.class.add("qgCMS");

  return html.async`
  <div id=container class=u2-card>
    <h1>${(await node.title()).string()}</h1>
    ${node.cont("main")}
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
