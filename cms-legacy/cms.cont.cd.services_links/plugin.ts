import { siteTemplate } from "../lib/siteTemplate.ts";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

// The PHP module carried the markup with hardcoded page ids and labels — that is one site's
// content, so it lives in data/<module>/index.ts here.
async function render(node: Node, data: { ctx: Ctx }): Promise<HtmlString | string> {
  return await siteTemplate(node, data) ?? "";
}

export const cms = {
  node: {
    render,
  },
};
