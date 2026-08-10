import { hee, html, type Ctx, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { siteTemplate } from "../lib/siteTemplate.ts";

export const name = "cms.layout.custom.7";
export const description = "Legacy custom layout of the PHP CMS; the successor is cms.layout.custom.9.";
export const needs = ["cms"];

export const settingsSchema = {
  properties: {
    "font-css-file": { type: "string", description: "URL or path to an additional CSS file included before the custom layout." },
  },
};

async function render(node: Node, data: { ctx: Ctx }): Promise<string | HtmlString> {
  const fontCss = String(await node.app.settings[name]["font-css-file"] ?? "");
  if (fontCss) data.ctx.res.html.head += `<link rel=stylesheet href="${hee(fontCss.replace(/\|/g, "%7C"))}">\n`;

  return await siteTemplate(node, data) ?? html.async`<div id=container><main>${node.cont("main")}</main></div>`;
}

export const cms = {
  node: {
    render,
  },
};
