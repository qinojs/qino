import type { Node } from "../../../cms/mod.ts";
import { getCtx, html, type HtmlString } from "../../../core/mod.ts";

export default function (node: Node, _vars: unknown = {}): HtmlString {
  const ctx = getCtx()
  return html`<iframe src="${ctx.req.appUrl}?cmspid=${node.id}&cms_noFrontend" frameborder=0 style="flex-basis:auto;width:100%;background:#fff;height:50rem"></iframe>`;
}
