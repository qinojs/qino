import { html } from "@qino/qino";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const PER_PAGE = 20;

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const child = node.cms.requestedChild(node);
  if (child) return html.async`<div>${child}</div>`;
  const t = node.app.t.in("cms.cont.event.category");
  const param = `cms_event_${node.id}_page`;
  const asked = Number(ctx.req.query[param]);
  const page = Number.isSafeInteger(asked) && asked > 0 ? asked : 1;
  const rows = await node.db.query`SELECT * FROM page WHERE basis = ${node.id} AND module = ${"cms.cont.event"}
    ORDER BY sort, id LIMIT ${PER_PAGE + 1} OFFSET ${(page - 1) * PER_PAGE}`;
  const events = [];
  for (const row of rows.slice(0, PER_PAGE)) {
    const event = await node.cms.node(Number(row.id), row);
    if (!await event.isReadable()) continue;
    events.push(html.async`<li><a href="${event.url()}">${event.showTitle()}</a></li>`);
  }
  const link = (page: number) => {
    const url = new URL(ctx.req.url.href);
    url.searchParams.set(param, String(page));
    return url.href;
  };
  return html.async`<div>
    ${node.cms.text(node, "title", { tag: "h2" })}
    ${events.length ? html.async`<ul>${events}</ul>` : html.async`<p>${t`No events found.`}</p>`}
    ${page > 1 || rows.length > PER_PAGE ? html.async`<nav aria-label="${t`Event pages`}">
      ${page > 1 ? html.async`<a href="${link(page - 1)}">${t`Previous`}</a>` : ""}
      ${rows.length > PER_PAGE ? html.async`<a href="${link(page + 1)}">${t`Next`}</a>` : ""}
    </nav>` : ""}
  </div>`;
}

export const cms = { node: { render, childUrls: true } };
