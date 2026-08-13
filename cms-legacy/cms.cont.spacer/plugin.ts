import { html } from "@qino/qino";

import { cssLength } from "../lib/css.ts";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

async function render(node: Node): Promise<HtmlString> {
  const height = cssLength(await node.settings.height);
  return html`<div${html.raw(height ? ` style="height:${height}"` : "")}></div>`;
}

export const cms = {
  node: {
    render,
    settingsSchema: { properties: { height: { type: "string", description: "Spacer height as a CSS length." } } },
  },
};
