import { html, type Ctx, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";

export const name = "cms.cont.stretchedItems1";
export const description = "Legacy row of equally stretched child contents.";
export const needs = ["cms"];

const settingsSchema = {
  properties: {
    cols: { type: "integer", minimum: 1, description: "Number of children." },
    "min-width": { type: "integer", description: "Width a child aims for before wrapping, in px." },
    gap: { type: "string", description: "Gap between the columns." },
    "row-gap": { type: "string", description: "Gap between the rows." },
    items_module: { type: "string", description: "Module of the children." },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  ctx.res.html.legacyScripts.add(ctx.req.moduleUrl + "cms.legacy.c1/pub/c1/stretchedItems.js");

  const cols = Math.max(1, Number(await node.settings.cols) || 1);
  const module = String(await node.settings.items_module ?? "") || "cms.cont.flexible";
  const minWidth = Number(await node.settings["min-width"]) || 0;

  const items: HtmlString[] = [];
  for (let i = 0; i < cols; i++) items.push(await html.async`${node.cont(String(i), module)}`);

  return html.async`<div class=c1StretchedItems style="--c1-items-width:${minWidth}" data-items-gap="${
    await node.settings.gap ?? ""
  }" data-items-row-gap="${await node.settings["row-gap"] ?? ""}">${html.join(items)}</div>`;
}

export const cms = {
  node: {
    render,
    settingsSchema,
  },
};
