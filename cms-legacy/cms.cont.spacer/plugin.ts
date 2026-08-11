import { html, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { cssLength } from "../lib/css.ts";

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
