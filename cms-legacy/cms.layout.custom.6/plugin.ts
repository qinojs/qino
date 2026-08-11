import { hee, html, type Ctx, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { siteTemplate } from "../lib/siteTemplate.ts";
import manifest from "./manifest.json" with { type: "json" };
const { name } = manifest;

// One font per site, not per page: app settings, not node settings.
export const settingsSchema = {
  properties: {
    "font-css-file": { type: "string", description: "URL or path to an additional CSS file included before the custom layout." },
  },
};

async function render(node: Node, data: { ctx: Ctx }): Promise<string | HtmlString> {
  const resHtml = data.ctx.res.html;
  const dataUrl = node.module!.dataUrl;

  // The PHP module included these two unconditionally.
  resHtml.styles.add(dataUrl + "pub/base.css");
  resHtml.styles.add(dataUrl + "pub/custom.css");

  const fontCss = String(await node.app.settings[name]["font-css-file"] ?? "");
  if (fontCss) resHtml.head += `<link rel=stylesheet href="${hee(fontCss.replace(/\|/g, "%7C"))}">\n`;

  return await siteTemplate(node, data) ?? html.async`<div id=container><main>${node.cont("main")}</main></div>`;
}

export const cms = {
  node: {
    render,
  },
};
