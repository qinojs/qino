import { html, type Ctx, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { sectionSettings } from "../lib/section.ts";
import { siteTemplate } from "../lib/siteTemplate.ts";

const settingsSchema = {
  properties: {
    ...sectionSettings.properties,
    "background white": { type: "boolean", description: "Renders the section on a white background." },
    "font white": { type: "boolean", description: "Renders the section text in white." },
    breit: { type: "boolean", description: "Widens the section beyond the default content width." },
    fixed: { type: "boolean", description: "Uses the site's fixed section variant." },
  },
};

async function render(node: Node, data: { ctx: Ctx }): Promise<string | HtmlString> {
  data.ctx.res.html.styles.add(node.module!.dataUrl + "pub/main.css");

  return await siteTemplate(node, data) ?? html.async`<section>${node.cont("main")}</section>`;
}

export const cms = {
  node: {
    render,
    settingsSchema,
  },
};
