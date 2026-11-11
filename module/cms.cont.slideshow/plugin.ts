import { html } from "@qino/qino";
import { cms_image } from "@qino/qino/cms.image";
import * as u2 from "@qino/qino/u2";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** The block's images, one slide each, in file-list order. */
async function render(node: Node, { ctx }: { ctx: Ctx }) {
  u2.assets(ctx, ["el/carousel/carousel.css", "el/carousel/carousel.js"]);
  const slides: HtmlString[] = [];
  for (const file of (await node.files()).values()) {
    if (file.mime.startsWith("image/")) slides.push(await cms_image(file, { width: 2000 }));
  }
  return html`<div><u2-carousel autoplay>${slides}</u2-carousel></div>`;
}

export const cms = { node: { render, css: ["pub/main.css"] } };
