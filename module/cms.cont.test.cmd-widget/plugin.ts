import { html } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    note: { type: "string", description: "Anything, so the block has a setting of its own." },
  },
};

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
    widget: "pub/settings.js", // takes the options slot in the panel
    js: ["pub/main.mjs"],
    settingsSchema,
  },
};
