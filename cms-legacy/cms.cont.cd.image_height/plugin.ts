import { html, type Ctx, type HtmlString } from "../../module/core/mod.ts";
import { cms_image2 } from "../../module/cms.image2/mod.ts";
import type { Node } from "../../module/cms/mod.ts";

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  ctx.res.html.styles.add(node.module!.dataUrl + "pub/main.css");

  return html.async`<section>${cms_image2(await node.file("img"), { width: 1088, editable: node.edit })}</section>`;
}

export const cms = {
  node: {
    render,
  },
};
