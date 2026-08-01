import { html, type HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import { cms_image2 } from "@qino/qino/cms.image2";

export const name = "cms.cont.example";
export const description = "CMS module example with text, images, settings, assets, and parts.";
export const needs = ["cms", "cms.image2"];

const settingsSchema = {
  properties: {
    color: { title: "Color", description: "Background color of the example box." },
  },
};

async function render(node: Node): Promise<HtmlString> {
  const cms = node.cms;
  const color = node.settings.color();
  const image = await cms.fileLang(node, 'image');
  return html.async`
    <div style="background:${color}">
      <h2>${cms.text(node, "title", { tag: "span", initial: { de: "Titel", en: "Title" } })}</h2>
      ${image && cms_image2(image, { width: 110, height: 110, fit: "contain" })}
      <div class=-text>${cms.text(node, "main", { initial: { de: "Text hier...", en: "Text here..." } })}</div>
      <div cms-part=teaser>${teaser(node)}</div>
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
