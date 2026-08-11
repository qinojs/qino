import { html, type HtmlString } from "../../module/core/mod.ts";
import { cms_image2 } from "../../module/cms.image2/mod.ts";
import type { Node } from "../../module/cms/mod.ts";

async function render(node: Node): Promise<HtmlString> {
  const root = await node.cms.node(1);
  const products = await root.bough({ module: "cms.cont.shp3.product.cd", type: "c" });
  const images: HtmlString[] = [], titles: HtmlString[] = [];
  for (const product of products.values()) {
    const url = await product.url();
    const image = await product.file("Produkt");
    images.push(html`<a href="${url}">${await cms_image2(image, {
      width: 200,
      height: 500,
      fit: "contain",
      if: 1,
      editable: product.edit,
    })}</a>`);
    titles.push(html`<a href="${url}"><div>${await product.showTitle()}</div></a>`);
  }
  return html`<div><div class=-image>${html.join(images)}</div><div class=-title>${html.join(titles)}</div></div>`;
}

export const cms = { node: { render, css: ["pub/main.css"] } };
