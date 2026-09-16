import { html } from "@qino/qino";
import * as u2 from "@qino/qino/u2";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** Centered box with the page title, in the shared CMS look (ui.css). */
async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {

  const resHtm = ctx.res.html;
  u2.assets(ctx, ["css/norm/norm.css", "css/base/base.css", "u2/auto.js"]);

  resHtm.styles.add(ctx.req.moduleUrl + "cms/pub/css/ui.css");
  resHtm.scripts.add(ctx.req.moduleUrl + "cms/pub/js/cms.mjs");
  resHtm.class.add("qgCMS");

  return html.async`
  <div id=container>
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
