import { html, type HtmlString } from "../../module/core/mod.ts";
import { cms_image2 } from "../../module/cms.image2/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { cmsText } from "../lib/text.ts";

export const name = "cms.cont.cd.2_bilder";
export const description = "Legacy pair of images with text, each optionally linked.";
export const needs = ["cms", "cms.image2", "cms.text"];

const settingsSchema = {
  properties: {
    "url links": { type: "string", description: "Target of the left image." },
    "url right": { type: "string", description: "Target of the right image." },
  },
};

async function half(node: Node, side: "left" | "right", url: string): Promise<HtmlString> {
  const image = cms_image2(await node.file(side), { width: 1000, style: "max-width:none", if: 1, editable: node.edit });
  const body = html.async`
    <div class=-image>${image}</div>
    <div class=-text>${cmsText(node, side)}</div>
  `;
  return url ? html.async`<a href="${url}" target=_blank>${body}</a>` : html.async`<div>${body}</div>`;
}

async function render(node: Node): Promise<HtmlString> {
  return html.async`<div>
  ${half(node, "left", String(await node.settings["url links"] ?? ""))}
  ${half(node, "right", String(await node.settings["url right"] ?? ""))}
</div>`;
}

export const cms = {
  node: {
    render,
    settingsSchema,
    css: ["pub/main.css"],
  },
};
