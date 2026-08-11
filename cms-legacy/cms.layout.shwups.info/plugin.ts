import { html, type Ctx, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  ctx.res.csp["style-src"]["https://fonts.googleapis.com"] = true;
  ctx.res.csp["font-src"]["https://fonts.gstatic.com"] = true;
  ctx.res.html.styles.add("https://fonts.googleapis.com/css?family=Poiret+One%7CExo");
  return html.async`<div id=content><h2>${node.showTitle()}</h2>${node.cont("1")}</div>`;
}

export const cms = { node: { render, css: ["pub/main.css"] } };
