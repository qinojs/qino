import { html } from "@qino/qino";

import { eventDate, eventDates, startsTodayOrLater } from "../lib/event2.ts";
import { cmsText } from "../lib/text.ts";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const selectedId = Number(ctx.req.query.cmscid);
  if (selectedId) {
    const selected = await node.cms.node(selectedId);
    if (selected.exists() && Number(selected.vs.basis) === node.id) return await html.async`<div>${selected.html()}</div>`;
  }

  const events: { node: Node; row: Record<string, unknown>; start: Date }[] = [];
  for (const child of (await node.children({ type: "*" })).values()) {
    if (!await child.isReadable()) continue;
    for (const row of await eventDates(child)) {
      if (!startsTodayOrLater(row.start_date)) continue;
      events.push({ node: child, row, start: eventDate(row.start_date) });
    }
  }
  events.sort((a, b) => +a.start - +b.start);

  const month = new Intl.DateTimeFormat(ctx.lang, { month: "long" });
  const day = new Intl.DateTimeFormat(ctx.lang, { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = new Intl.DateTimeFormat(ctx.lang, { hour: "2-digit", minute: "2-digit" });
  const rows: HtmlString[] = [];
  let lastMonth = "";
  for (const event of events) {
    const key = `${event.start.getFullYear()}-${event.start.getMonth()}`;
    if (key !== lastMonth) rows.push(html`<tr class=-month><td colspan=2><h3>${month.format(event.start)}</h3></td></tr>`);
    lastMonth = key;
    const url = await event.node.url();
    const label = event.row.all_day ? day.format(event.start) : `${day.format(event.start)}, ${time.format(event.start)}`;
    rows.push(await html.async`<tr><td><time datetime="${event.start.toISOString()}">${label}</time></td><td><a href="${url}?cmscid=${event.node.id}">${event.node.showTitle()}</a></td></tr>`);
  }

  return html`<div>
  ${await cmsText(node, "title", "h1")}
  ${await (await node.cont("before")).html()}
  <div style="overflow:auto"><table><tbody>${rows}</tbody></table></div>
  ${await (await node.cont("after")).html()}
</div>`;
}

export const cms = { node: { render } };
