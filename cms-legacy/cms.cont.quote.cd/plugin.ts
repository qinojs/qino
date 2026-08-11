import { html, type Ctx, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { siteTemplate } from "../lib/siteTemplate.ts";

const settingsSchema = {
  properties: {
    "background-color": { type: "string", description: "Section background color." },
    heading: { type: "integer", minimum: 0, maximum: 3, default: 2, description: "Heading level; zero hides it." },
  },
};

async function render(node: Node, data: { ctx: Ctx }): Promise<string | HtmlString> {
  data.ctx.res.html.styles.add(node.module!.dataUrl + "pub/main.css");
  return await siteTemplate(node, data) ?? html.async`<section>${node.cont("main")}</section>`;
}

export const cms = { node: { render, settingsSchema } };
