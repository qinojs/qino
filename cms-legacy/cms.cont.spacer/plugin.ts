import { html } from "@qino/qino";

import { cssLength } from "../lib/css.ts";

import type { Node } from "@qino/qino/cms";

async function render(node: Node) {
  const height = cssLength(await node.settings.height);
  return html`<div${html.raw(height ? ` style="height:${height}"` : "")}></div>`;
}

export const cms = {
  node: {
    render,
    settingsSchema: { properties: { height: { type: "string", description: "Spacer height as a CSS length." } } },
  },
};
