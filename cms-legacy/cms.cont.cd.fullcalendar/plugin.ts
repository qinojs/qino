import { html, sql } from "@qino/qino";

import { cmsText } from "../lib/text.ts";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  let rows: Record<string, unknown>[] = [];
  try {
    rows = await node.db.query`SELECT * FROM ${sql.id("event2_dates")} ORDER BY start_date`;
  } catch {/**/}
  const startId = Number(await node.settings["start page"]);
  const start = startId ? await node.cms.node(startId) : await node.page();
  const date = new Intl.DateTimeFormat(ctx.lang, { dateStyle: "medium", timeStyle: "short" });
  const events: HtmlString[] = [];
  for (const row of rows) {
    const event = await node.cms.node(Number(row.page_id));
    if (!event.exists() || !await event.isReadable() || !await event.in(start)) continue;
    const url = await event.url();
    const startDate = new Date(String(row.start_date).replace(" ", "T"));
    if (Number.isNaN(+startDate)) continue;
    events.push(await html.async`<li><time datetime="${startDate.toISOString()}">${date.format(startDate)}</time> <a href="${url}?cmscid=${event.id}">${event.showTitle()}</a></li>`);
  }
  return html`<div>${await cmsText(node, "title", "h2")}<div class=-wrapper><ul class=-calendar>${events}</ul></div></div>`;
}

export const cms = { node: { render } };
