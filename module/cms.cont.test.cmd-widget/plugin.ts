import { html } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

// One root element, as every cms module must return — the widget is mounted into .-files.
function render(node: Node): Promise<HtmlString> {
  return html.async`<div>
  <p>${node.app.t`A test block: the panel's files widget, rendered inside page content.`}</p>
  <div class=-files></div>
</div>`;
}

export const cms = {
  node: {
    render,
    js: ["pub/main.mjs"],
  },
};
