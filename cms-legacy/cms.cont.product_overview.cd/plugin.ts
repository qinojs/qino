import { html } from "@qino/qino";
import { cms_image2 } from "@qino/qino/cms.image2";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

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
  return html`<div><div class=-image>${images}</div><div class=-title>${titles}</div></div>`;
}

export const cms = { node: { render, css: ["pub/main.css"] } };
