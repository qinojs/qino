import { hee, html, type Ctx, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";

export const name = "cms.layout.custom.6";
export const description = "Legacy custom layout of the PHP CMS; the successor is cms.layout.custom.9.";
export const needs = ["cms"];

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

  // The layout itself is site data, as in the PHP version: qg/<module>/index.php → data/<module>/index.ts
  const customPath = node.module!.data + "index.ts";
  try {
    await Deno.stat(customPath);
    const mod = await import(customPath);
    if (typeof mod.default === "function") return mod.default(node, data);
  } catch { /* no custom layout override */ }

  return html.async`<div id=container><main>${node.cont("main")}</main></div>`;
}

export const cms = {
  node: {
    render,
  },
};
