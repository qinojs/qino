import { html } from "@qino/qino";

import { sectionAttr } from "../lib/bg.ts";
import { siteTemplate } from "../lib/siteTemplate.ts";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    "background-color": { type: "string", description: "Section background color; a dark one switches the text to white." },
    heading: { type: "integer", minimum: 0, maximum: 3, default: 2, description: "Heading level of the title; zero hides it." },
  },
};

async function render(node: Node, data: { ctx: Ctx }): Promise<string | HtmlString> {
  const site = await siteTemplate(node, data);
  if (site) return site;

  const level = Number(await node.settings.heading) || 0;
  const tag = html.raw(`h${Math.min(Math.max(level, 1), 6)}`);
  const title = level ? html.async`<${tag}>${node.showText("title")}</${tag}>` : "";

  return html.async`<section${html.raw(await sectionAttr(node))}>${title}${node.cont("main")}</section>`;
}

export const cms = {
  node: {
    render,
    settingsSchema,
  },
};
