import { html } from "@qino/qino";
import { cms_image } from "@qino/qino/cms.image";

import type { Node } from "@qino/qino/cms";

async function render(node: Node) {
  return html.async`<section>${cms_image(await node.file("img"), { width: 1088, editable: await node.edit() })}</section>`;
}

export const cms = {
  node: {
    render,
  },
};
