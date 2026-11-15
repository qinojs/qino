import { html, sql } from "@qino/qino";
import { answer, formatDates, PARAM } from "@qino/qino/cms.cont.event";
import { ahead, overview, zoneOf } from "@qino/qino/cms.event";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const PER_PAGE = 20;

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const child = node.cms.requestedChild(node);
  if (child) return html.async`<div>${child}</div>`;
  // the feed: every readable event of the category, upcoming dates only
  await answer(ctx, node, async () => {
    const all = await Promise.all((await node.db.col`SELECT p.id FROM page p JOIN cms_event ev ON ev.id = p.id WHERE p.basis = ${node.id}`)
      .map((id) => node.cms.node(Number(id))));
    const readable = await Promise.all(all.map((c) => c.isReadable()));
    return all.filter((_, i) => readable[i]);
  });
  const t = node.app.t.in("cms.cont.event.category");
  const param = `cms_event_${node.id}_page`;
  const asked = Number(ctx.req.query[param]);
  const page = Number.isSafeInteger(asked) && asked > 0 ? asked : 1;
  // its events, what is still ahead, the next date first
  const from = Temporal.Now.instant(), now = ahead(from);
  const next = sql`SELECT MIN(d.${sql.id("start")}) FROM cms_event_date d WHERE d.event_id = p.id AND d.${sql.id("end")} >= ${now}`;
  const rows = await overview(node.db, sql`SELECT p.* FROM (SELECT p.*, (${next}) AS next_start FROM page p JOIN cms_event ev ON ev.id = p.id
      WHERE p.basis = ${node.id}) p WHERE p.next_start IS NOT NULL
    ORDER BY p.next_start, p.id LIMIT ${PER_PAGE + 1} OFFSET ${(page - 1) * PER_PAGE}`, sql`p.next_start, p.id`, { from });
  const events = [];
  for (const { row, event, dates, count } of rows.slice(0, PER_PAGE)) {
    const item = await node.cms.node(Number(row.id), row);
    if (!await item.isReadable()) continue;
    events.push(html.async`<li><article>
      <h3><a href="${item.url()}">${item.showTitle()}</a></h3>
      <ul>${formatDates(dates, ctx.lang, await zoneOf(node.app, event)).map((date) => html`<li>${date}</li>`)}</ul>
      ${event.address_locality ? html`<p>${event.address_locality}</p>` : ""}
      ${count > dates.length ? html.async`<p><a href="${item.url()}">${t`All dates`} (${count})</a></p>` : ""}
    </article></li>`);
  }
  const link = (page: number) => {
    const url = new URL(ctx.req.url.href);
    url.searchParams.set(param, String(page));
    return url.href;
  };
  return html.async`<div>
    ${node.cms.text(node, "title", { tag: "h2" })}
    ${events.length ? html.async`<ul>${events}</ul>` : html.async`<p>${t`No events found.`}</p>`}
    <p><a href="?${PARAM}=${node.id}" rel=nofollow download>${t`Subscribe in calendar`}</a></p>
    ${page > 1 || rows.length > PER_PAGE ? html.async`<nav aria-label="${t`Event pages`}">
      ${page > 1 ? html.async`<a href="${link(page - 1)}">${t`Previous`}</a>` : ""}
      ${rows.length > PER_PAGE ? html.async`<a href="${link(page + 1)}">${t`Next`}</a>` : ""}
    </nav>` : ""}
  </div>`;
}

export const cms = { node: { render, childUrls: true } };
