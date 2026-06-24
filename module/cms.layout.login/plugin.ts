import type { Node } from "../cms/mod.ts";
import { u2Root, type RequestContext } from "../core/mod.ts";

export const name = "cms.layout.login";

async function render(node: Node, {ctx}: { ctx: RequestContext }): Promise<string> {

  const html = ctx.html;
  html.styles.add(u2Root + "css/norm/norm.css");
  html.styles.add(u2Root + "css/base/base.css");
  html.scripts.add(u2Root + "u2/auto.js");

  html.styles.add(ctx.sysURL + "cms/pub/css/ui.css");
  html.legacyScripts.add(ctx.sysURL + "core/pub/js/c1.js");
  html.scripts.add(ctx.sysURL + "cms/pub/js/cms.mjs");

  const host = ctx.req.header("host") ?? "";
  const titleObj = await node.title();
  const title = await titleObj.string();
  const mainCont = await node.cont("main");

  return `
  <div id=container class=qgCMS>
    <div id=head>
      <div id=title>${title}</div>
      <div id=subtitle>${host}</div>
    </div>
    <div id=content>
      ${await mainCont.html()}
    </div>
  </div>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    render,
  },
};
