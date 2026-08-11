import { html, type Ctx, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { siteTemplate } from "../lib/siteTemplate.ts";

async function render(node: Node, data: { ctx: Ctx }): Promise<string | HtmlString> {
  data.ctx.res.html.styles.add(node.module!.dataUrl + "pub/custom.css");
  return await siteTemplate(node, data) ?? html.async`<div id=container><main>${node.cont("1")}</main></div>`;
}

export const cms = { node: { render, css: ["pub/default.css"] } };
