import { html } from "@qino/qino";
import { cms_image2 } from "@qino/qino/cms.image2";

import { backgroundStyle } from "../lib/bg.ts";
import { cmsText } from "../lib/text.ts";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    link: { type: "string", description: "Target of the box." },
  },
};

async function render(node: Node): Promise<HtmlString> {
  const bg = await backgroundStyle(node, "Hintergrund-Bild", { w: 510, h: 650, q: 78 });
  const link = String(await node.settings.link ?? "");

  return html.async`<div>
  <div class=-bg style="${bg}"></div>
  <a href="${link}" class=-body target=_blank>
    ${cmsText(node, "title", "h2")}
    ${cmsText(node, "price", "h3")}
    <div class=-image>${cms_image2(await node.file("Bild"), { width: 470, editable: node.edit })}</div>
    ${cmsText(node, "nr", "p")}
  </a>
</div>`;
}

export const cms = {
  node: {
    render,
    settingsSchema,
    css: ["pub/main.css"],
  },
};
