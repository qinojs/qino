import { html } from "@qino/qino";
import { cms_image2 } from "@qino/qino/cms.image2";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

async function render(node: Node): Promise<HtmlString> {
  return html.async`<section>${cms_image2(await node.file("img"), { width: 1088, editable: await node.edit() })}</section>`;
}

export const cms = {
  node: {
    render,
  },
};
