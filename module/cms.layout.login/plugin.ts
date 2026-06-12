import type { Node } from "../cms/mod.ts";
import type { RequestContext } from "../core/mod.ts";

export const name = "cms.layout.login";

const u2Root = "https://cdn.jsdelivr.net/gh/u2ui/u2@1.3.17/";

async function render(node: Node, {ctx}: { ctx: RequestContext }): Promise<string> {

  ctx.html.styles.add(u2Root + "css/norm/norm.css");
  ctx.html.styles.add(u2Root + "css/base/base.css");
  ctx.html.scripts.add(u2Root + "u2/auto.js");
  
  ctx.html.styles.add(ctx.sysURL + "cms/pub/css/ui.css");
  ctx.html.legacyScripts.add(ctx.sysURL + "core/pub/js/c1.js");
  ctx.html.scripts.add(ctx.sysURL + "cms/pub/js/cms.mjs");

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
