import type { Node } from "../cms/lib/Node.ts";
import type { RequestContext } from "../core/lib/RequestContext.ts";

export const name = "cms.layout.login";

async function render(node: Node, {ctx}: { ctx: RequestContext }): Promise<string> {

  ctx.html.styles.add("https://cdn.jsdelivr.net/gh/u2ui/u2@1.3.6/css/norm/norm.css");
  ctx.html.styles.add("https://cdn.jsdelivr.net/gh/u2ui/u2@1.3.6/css/base/base.css");
  ctx.html.styles.add(ctx.sysURL + "cms.frontend.1/pub/css/main.css");
  ctx.html.legacyScripts.add(ctx.sysURL + "core/pub/js/c1.js");
  ctx.html.scripts.add(ctx.sysURL + "cms/pub/js/cms.mjs");

  ctx.html.meta["viewport"] = "width=device-width";

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
