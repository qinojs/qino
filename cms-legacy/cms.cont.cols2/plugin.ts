import { html, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { cssLength } from "../lib/css.ts";

export const name = "cms.cont.cols2";
export const description = "Legacy responsive table-style columns.";
export const needs = ["cms"];

const settingsSchema = {
  properties: {
    cols: { type: "integer", minimum: 2, default: 2 },
    space: { type: "string", description: "Horizontal space between columns." },
    "row-space": { type: "string", description: "Vertical space after stacking columns." },
    "space-around": { type: "boolean" },
    "min-screen-width": { type: "integer", minimum: 0 },
  },
};

async function render(node: Node): Promise<HtmlString> {
  const cols = Math.max(2, Number(await node.settings.cols) || 2);
  const space = cssLength(await node.settings.space);
  const rowSpace = cssLength(await node.settings["row-space"]) || space;
  const around = !!await node.settings["space-around"];
  const minWidth = Math.max(0, Number(await node.settings["min-screen-width"]) || 0);
  const items: HtmlString[] = [];
  const gap = () => html`<i${html.raw(space ? ` style="width:${space};height:${rowSpace}"` : "")}></i>`;

  if (space && around) items.push(gap());
  for (let i = 0; i < cols; i++) {
    if (space && (around || i)) items.push(gap());
    const width = cssLength(await node.settings[`row_${i + 1}`]);
    items.push(await html.async`<div${html.raw(width ? ` style="width:${width}"` : "")}>${node.cont(String(i))}</div>`);
  }

  const responsive = minWidth
    ? html`<style>@media(max-width:${minWidth}px){[qcms-id="${node.id}"]{display:block;width:auto}[qcms-id="${node.id}"]>*{display:block;min-width:100%}}</style>`
    : "";
  return html`<div>${responsive}${html.join(items)}</div>`;
}

export const cms = { node: { render, settingsSchema, css: ["pub/main.css"] } };
