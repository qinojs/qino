import { html } from "@qino/qino";
import * as u2 from "@qino/qino/u2";

import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const OLD = "cms.layout.login"; // this module replaces it

/** Centered box with the page title, in the shared CMS look (ui.css). */
async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {

  const resHtm = ctx.res.html;
  u2.assets(ctx, ["css/norm/norm.css", "css/base/base.css", "u2/auto.js"]);

  resHtm.styles.add(ctx.req.moduleUrl + "cms/pub/css/ui.css");
  resHtm.scripts.add(ctx.req.moduleUrl + "cms/pub/js/cms.mjs");
  resHtm.class.add("qgCMS");

  return html.async`
  <div id=container class=u2-card>
    <h1>${(await node.title()).string()}</h1>
    ${node.cont("main")}
  </div>`;
}

/** Take over the pages of the layout this one replaces, and retire it. */
export async function install({ app }: { app: App }): Promise<void> {
  await app.db.query`UPDATE page SET module = ${manifest.name} WHERE module = ${OLD}`;
  await app.modules.uninstall(OLD).catch(() => {});
}

export const cms = {
  node: {
    css: [
      "pub/main.css",
    ],
    render,
  },
};
