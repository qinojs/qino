import { html } from "@qino/qino";
import { cms_image2 } from "@qino/qino/cms.image2";

import type { Node } from "@qino/qino/cms";

async function render(node: Node) {
  return html.async`<section>${cms_image2(await node.file("img"), { width: 1088, editable: await node.edit() })}</section>`;
}

export const cms = {
  node: {
    render,
  },
};
