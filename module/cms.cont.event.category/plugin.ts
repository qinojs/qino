import { html, sql } from "@qino/qino";
import { answer, formatDates, PARAM } from "@qino/qino/cms.cont.event";
import { ahead, overview } from "@qino/qino/cms.event";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const PER_PAGE = 20;

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const child = node.cms.requestedChild(node);
  if (child) return html.async`<div>${child}</div>`;
  // the feed: every readable event of the category, upcoming dates only
  await answer(ctx, node, async () => {
    const all = [...(await node.children({ type: "c" })).values()].filter((c) => c.vs.module === "cms.cont.event");
    const readable = await Promise.all(all.map((c) => c.isReadable()));
    return all.filter((_, i) => readable[i]);
  });
  const t = node.app.t.in("cms.cont.event.category");
  const param = `cms_event_${node.id}_page`;
  const asked = Number(ctx.req.query[param]);
  const page = Number.isSafeInteger(asked) && asked > 0 ? asked : 1;
  // what is still ahead, the next date first
  const from = Temporal.Now.instant(), now = ahead(from);
  const rows = await overview(node.db, sql`SELECT p.*, (SELECT MIN(e.${sql.id("start")}) FROM cms_event e WHERE e.node_id = p.id AND e.${sql.id("end")} >= ${now}) AS next_start
    FROM page p WHERE p.basis = ${node.id} AND p.module = ${"cms.cont.event"}
      AND EXISTS (SELECT 1 FROM cms_event e WHERE e.node_id = p.id AND e.${sql.id("end")} >= ${now})
    ORDER BY next_start, p.id LIMIT ${PER_PAGE + 1} OFFSET ${(page - 1) * PER_PAGE}`, sql`p.next_start, p.id`, { from });
  const events = [];
  for (const { row, blocks, count } of rows.slice(0, PER_PAGE)) {
    const event = await node.cms.node(Number(row.id), row);
    if (!await event.isReadable()) continue;
    events.push(html.async`<li><article>
      <h3><a href="${event.url()}">${event.showTitle()}</a></h3>
      <ul>${formatDates(blocks, ctx.lang, String(event.settings.time_zone() ?? "UTC")).map((date) => html`<li>${date}</li>`)}</ul>
      ${event.settings.address_locality() ? html`<p>${event.settings.address_locality()}</p>` : ""}
      ${count > blocks.length ? html.async`<p><a href="${event.url()}">${t`All dates`} (${count})</a></p>` : ""}
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
