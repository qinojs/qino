import { html } from "@qino/qino";
import { cms_image2 } from "@qino/qino/cms.image2";
//import { assets } from "@qino/qino/u2";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const MAX_LENGTH = 100;

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  //assets(ctx, ["el/masonry/masonry.css", "el/masonry/masonry.js", "attr/lightbox/lightbox.js"]);
  const images: HtmlString[] = [];
  for (const file of (await node.files()).values()) {
    if (!file.mime.startsWith("image/")) continue;
    images.push(html`<a href="${await file.url()}" u2-lightbox="gallery-${node.id}">
      ${await cms_image2(file, {})}
    </a>`);
  }
  const width = node.settings["col-width"]();
  const style = width && width.length <= MAX_LENGTH && !/[;{}]/.test(width) ? html` style="--u2-Items-width:${width}"` : "";
  return html`<u2-masonry${style}>${images}</u2-masonry>`;
}

export const cms = {
  node: {
    render,
    css: ["pub/main.css"],
    settingsSchema: {
      properties: {
        "col-width": { type: "string", maxLength: MAX_LENGTH, description: "Minimum column width as a CSS value, e.g. 11em or 33vw. Leave empty to use the CSS default." },
      },
    },
  },
};
