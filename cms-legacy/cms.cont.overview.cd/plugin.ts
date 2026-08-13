import { html } from "@qino/qino";

import { backgroundAttr } from "../lib/bg.ts";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

async function render(node: Node): Promise<HtmlString> {
  const page = await node.page();
  const startId = Number(await node.settings["start page"]);
  const start = startId && (await node.cms.node(startId)).exists() ? await node.cms.node(startId) : page;
  const moduleName = String(await node.settings.module ?? "");
  const all = moduleName ? [...(await start.bough({ type: "*" })).values()].filter((p) => p.vs.module === moduleName) : [...(await start.children({ type: "p" })).values()];
  const inNavi = String(await node.settings["in navi"] ?? "");
  const pages: Node[] = [];
  for (const item of all) {
    if (!await item.isReadable()) continue;
    if (inNavi === "yes" && !item.vs.visible || inNavi === "no" && item.vs.visible) continue;
    pages.push(item);
  }
  if (await node.settings["sort by"] === "Date") {
    const starts = new Map(await Promise.all(pages.map(async (item) => [item.id, await item.onlineStart()] as const)));
    pages.sort((a, b) => (starts.get(a.id) ?? 0) - (starts.get(b.id) ?? 0));
  }
  if (await node.settings["sort direction"] === "Descending") pages.reverse();
  const limit = Math.max(0, Number(await node.settings.limit) || 0);
  const items: HtmlString[] = [];
  for (const item of limit ? pages.slice(0, limit) : pages) {
    const url = await item.url();
    items.push(await html.async`<div class=-item-wrapper><div class=-item data-c1-href="${url}"${html.raw(await backgroundAttr(item, "overview preview"))}>
  <span class=-text><a href="${url}">${item.showTitle()}</a><br></span>
</div></div>`);
  }
  return html`<div class=cd-overview>${html.join(items)}</div>`;
}

export const cms = { node: { render } };
