import type { Node } from "../cms/lib/Node.ts";
import { cms_image2 } from "../cms.image2/mod.ts";
import { html, type HtmlString } from "../core/lib/util.ts";

export const name = "cms.cont.example";
export const needs = ["cms", "cms.image2"];

const settingsSchema = {
  properties: {
    color: { title: "Color", description: "Background color of the example box." },
  },
};

async function render(node: Node): Promise<HtmlString> {
  const color = node.settings.color();
  const image = await node.cms.fileLang('image', node);
  return html.async`
  	<div class="example-box" style="background:${color}">
      <h2>${node.cms.text(node, "title", { tag: "span", initial: { de: "Titel", en: "Title" } })}</h2>
      ${image && cms_image2(image, { width: 110, height: 110, fit: "contain" })} contain
	  <br>
      ${image && cms_image2(image, { width: 110, height: 110, fit: "cover" })} cover
      <div class="-text">${node.cms.text(node, "main", { initial: { de: "Text hier...", en: "Text here..." } })}</div>
      <div cms-part="teaser">${teaser(node)}</div>
    </div>`;
}

function teaser(node: Node): Promise<HtmlString> {
  return html.async`<a href="${node.url()}">${node.cms.text(node, "title", { tag: "span" })} <small>${new Date().toISOString()}</small></a>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js:  ["pub/main.js"],
    render,
    parts: { teaser },
    settingsSchema,
  },
};
