import type { Node } from "../../../cms/lib/Node.ts";
import { getCtx } from "qg";

export default async function (node: Node, _vars: any = {}): Promise<string> {
  const ctx = getCtx()
  return `<iframe src="${ctx.appURL}?cmspid=${node}&qgCmsNoFrontend" frameborder=0 style="flex-basis:auto;width:100%;background:#fff;height:800px"></iframe>`;
}
