import { html } from "@qino/qino";

import { sectionAttr } from "../lib/bg.ts";
import { cmsText } from "../lib/text.ts";
import { sectionSettings } from "../lib/section.ts";

import type { Node } from "@qino/qino/cms";

async function render(node: Node) {
  return html.async`<section${html.raw(await sectionAttr(node))}>
  <div class=l1_width>
    ${cmsText(node, "small", "h4")}
    ${cmsText(node, "big", "h1")}
  </div>
</section>`;
}

export const cms = {
  node: {
    render,
    settingsSchema: sectionSettings,
  },
};
