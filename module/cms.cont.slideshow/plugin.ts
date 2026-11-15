import { html } from "@qino/qino";
import { cms_image } from "@qino/qino/cms.image";
import * as u2 from "@qino/qino/u2";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** The block's images, one slide each, in file-list order. */
async function render(node: Node, { ctx }: { ctx: Ctx }) {
  u2.assets(ctx, ["el/carousel/carousel.css", "el/carousel/carousel.js"]);
  const slides = await Promise.all([...(await node.files()).values()].filter((file) => file.mime.startsWith("image/"))
    .map((file) => cms_image(file, { width: 2000 })));
  return html`<div><u2-carousel autoplay>${slides}</u2-carousel></div>`;
}

export const cms = { node: { render, css: ["pub/main.css"] } };
