import { html } from "@qino/qino";

import type { Node } from "@qino/qino/cms";

const settingsSchema = { properties: { "no body padding": { type: "boolean", description: "The content reaches the box's edges." } } };

/** A box with a dark title bar; the title shows while it has one or in edit mode. */
async function render(node: Node) {
  const title = (await node.showTitle()).plain().trim();
  const head = title || await node.edit() ? html.async`<div class=-head>${node.cms.text(node, "title", { tag: "span", class: "-head" })}</div>` : "";
  const pad = await node.settings["no body padding"] ? html.raw(' style="padding:0"') : "";
  return html.async`<div class=c1-box>${head}<div class=-body${pad}> ${node.cont("main")} </div></div>`;
}

export const cms = { node: { render, settingsSchema, css: ["pub/main.css"] } };
