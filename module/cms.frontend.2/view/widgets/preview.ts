import type { Node } from "../../../cms/mod.ts";
import { getCtx } from "../../../core/mod.ts";

export default function (node: Node, _vars: unknown = {}): string {
  const ctx = getCtx()
  return `<iframe src="${ctx.req.basePath}?cmspid=${node}&cms_noFrontend" frameborder=0 style="flex-basis:auto;width:100%;background:#fff;height:800px"></iframe>`;
}
