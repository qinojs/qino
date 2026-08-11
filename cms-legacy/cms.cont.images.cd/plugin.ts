import { html, type Ctx, type HtmlString } from "../../module/core/mod.ts";
import { cms_image2 } from "../../module/cms.image2/mod.ts";
import type { Node } from "../../module/cms/mod.ts";

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  ctx.res.html.styles.add(node.module!.dataUrl + "pub/main.css");
  const images: HtmlString[] = [];
  for (const file of Object.values(await node.files())) {
    if (!file.mime.startsWith("image/")) continue;
    images.push(html`<div>${await cms_image2(file, { width: 200, height: 200, fit: "contain", editable: node.edit })}</div>`);
  }
  return html`<div><div class=l1_width><div class=c1-flex-grid>${html.join(images)}</div></div></div>`;
}

export const cms = { node: { render } };
