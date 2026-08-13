import { getCtx, html } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export default function (node: Node, _vars: unknown = {}): HtmlString {
  const ctx = getCtx()
  return html`<iframe src="${ctx.req.appUrl}?cmspid=${node.id}&cms_noFrontend" frameborder=0 style="flex-basis:auto;width:100%;background:#fff;height:50rem"></iframe>`;
}
