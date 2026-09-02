import { html } from "@qino/qino";
import { cms_image2 } from "@qino/qino/cms.image2";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

async function render(node: Node): Promise<HtmlString> {
  const images: HtmlString[] = [];
  for (const file of (await node.files()).values()) {
    if (!file.mime.startsWith("image/")) continue;
    images.push(html`<div>${await cms_image2(file, { width: 200, height: 200, fit: "contain", editable: node.edit })}</div>`);
  }
  return html`<div><div class=l1_width><div class=c1-flex-grid>${images}</div></div></div>`;
}

export const cms = { node: { render } };
