import { html, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { sectionAttr } from "../lib/bg.ts";
import { cmsText } from "../lib/text.ts";
import { sectionSettings } from "../lib/section.ts";

async function render(node: Node): Promise<HtmlString> {
  return html.async`<section${html.raw(await sectionAttr(node))}>
  <div class=l1_width>
    ${cmsText(node, "small", "h4")}
    ${cmsText(node, "big", "h3")}
    ${cmsText(node, "text", "p")}
  </div>
</section>`;
}

export const cms = {
  node: {
    render,
    settingsSchema: sectionSettings,
  },
};
