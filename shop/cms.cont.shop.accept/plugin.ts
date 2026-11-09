import { html } from "@qino/qino";

import type { Node } from "@qino/qino/cms";

/** Sits in the form of cms.cont.shop.buy: it is required, so it holds the order back. */
const render = (node: Node) => html.async`<label>
  <input type=checkbox required>
  ${node.cms.text(node, "agb", { tag: "span", initial: { de: "Ich akzeptiere die AGB", en: "I accept the terms" } })}
</label>`;

export const cms = { node: { render } };
