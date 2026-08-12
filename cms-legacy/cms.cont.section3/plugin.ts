import { html, type Ctx, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { sectionStyle, styleAttr } from "../lib/bg.ts";
import { sectionSettings } from "../lib/section.ts";
import { siteTemplate } from "../lib/siteTemplate.ts";

const settingsSchema = {
  properties: {
    ...sectionSettings.properties,
    "background white": { type: "boolean", description: "Renders the section on a white background." },
    "font white": { type: "boolean", description: "Renders the section text in white." },
    breit: { type: "boolean", description: "Widens the section beyond the default content width; needs the site's own markup." },
    fixed: { type: "boolean", description: "Marks the section as the site's fixed variant (class -Fix)." },
  },
};

async function render(node: Node, data: { ctx: Ctx }): Promise<string | HtmlString> {
  const site = await siteTemplate(node, data);
  if (site) return site;

  // No markup of its own: the shell renders what the settings can say without it.
  let style = await sectionStyle(node);
  if (await node.settings["background white"]) style += "background-color:#fff;";
  if (await node.settings["font white"]) style += "color:#fff;";
  const cls = await node.settings.fixed ? " class=-Fix" : "";

  return html.async`<section${html.raw(cls)}${html.raw(styleAttr(style))}>${node.cont("main")}</section>`;
}

export const cms = {
  node: {
    render,
    settingsSchema,
  },
};
