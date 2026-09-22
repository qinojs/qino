import { html } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

async function render(node: Node): Promise<HtmlString> {
  return html.async`<section class=u2-width>
    ${node.cms.text(node, "title", { tag: "h2", if: true })}
    ${(await node.cont("main", "cms.cont.flexible")).html()}
  </section>`;
}

export const cms = {
  node: {
    render,
    css: ["pub/main.css"],
  },
};
