import type { Node } from "../cms/lib/Node.ts";
import type { RequestContext } from "../core/lib/RequestContext.ts";

export const name = "cms.layout.login";

async function render(node: Node, {ctx}: { ctx: RequestContext }): Promise<string> {

  ctx.html.addCSSFile("https://cdn.jsdelivr.net/gh/u1ui/norm.css@3.2.0/norm.min.css");
  ctx.html.addCSSFile("https://cdn.jsdelivr.net/gh/u1ui/base.css@3.2.0/base.min.css");
  ctx.html.addCSSFile(ctx.sysURL + "cms.frontend.1/pub/css/main.css");
  ctx.html.addJSFile(ctx.sysURL + "core/pub/js/c1.js");
  ctx.html.addJSFile(ctx.sysURL + "core/pub/js/c1/onElement.js");
  ctx.html.addJSFile(ctx.sysURL + "core/pub/js/c1/dom.js");
  ctx.html.addJSM(ctx.sysURL + "cms/pub/js/cms.mjs");
  ctx.html.addJSFile(ctx.sysURL + "core/pub/js/qg.js");

  ctx.html.meta["viewport"] = "width=device-width";

  const host = ctx.server.HTTP_HOST;
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
    render,
  },
};
