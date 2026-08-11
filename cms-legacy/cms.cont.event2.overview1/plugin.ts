import { html, sql, type Ctx, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { backgroundAttr } from "../lib/bg.ts";
import { eventDate, startsTodayOrLater } from "../lib/event2.ts";

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  let rows: Record<string, unknown>[] = [];
  try { rows = await node.db.query`SELECT * FROM ${sql.id("event2_dates")} ORDER BY start_date`; } catch {/**/}
  const past = !!await node.settings.past;
  rows = rows.filter((row) => past !== startsTodayOrLater(row.start_date));
  if (past) rows.reverse();
  const startId = Number(await node.settings["start page"]);
  const start = startId ? await node.cms.node(startId) : await node.page();
  const limit = Math.max(0, Number(await node.settings["limit items"]) || 5);
  const date = new Intl.DateTimeFormat(ctx.lang, { day: "2-digit", month: "short" });
  const items: HtmlString[] = [];

  for (const row of rows) {
    const event = await node.cms.node(Number(row.page_id));
    if (!event.exists() || !await event.isReadable() || !await event.in(start)) continue;
    const parent = await event.parent();
    const url = `${await event.url()}?cmscid=${event.id}`;
    const color = String(await parent?.settings.color ?? "");
    const startDate = eventDate(row.start_date);
    items.push(await html.async`<div class=-item-wrapper><div class=-item data-c1-href="${url}"${html.raw(await backgroundAttr(event, "main"))}>
  <span class=-date${html.raw(color ? ` style="background:${color}"` : "")}>${date.format(startDate)}</span>
  <span class=-text><a href="${url}">${event.showTitle()}</a>${await node.settings.show_category && parent ? html`<br>${parent.showTitle()}` : ""}</span>
</div></div>`);
    if (limit && items.length >= limit) break;
  }

  return html`<div>${items.length ? html`<div class=cd-overview>${html.join(items)}</div>` : await node.showText("_no_events")}</div>`;
}

export const cms = { node: { render } };
