import { AccessError, html, sql, sqlSearch } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { overview, formatDates } from "@qino/qino/cms.cont.event";

import detail from "./detail.ts";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const PER_PAGE = 50;

export default async function render(node: Node, { ctx, vars = {}, listOnly = false }: {
  ctx: Ctx; vars?: Record<string, unknown>; listOnly?: boolean;
}) {
  if (!await node.isReadable()) throw new AccessError();
  const t = node.app.t.in("cms.backend.event"), url = ctx.req.url.toURL();
  for (const key of ["search", "category", "sort", "page"]) if (key in vars) {
    if (vars[key]) url.searchParams.set(key, String(vars[key]));
    else url.searchParams.delete(key);
  }
  const self = await (await node.page()).url();
  const eventId = Number(url.searchParams.get("event"));
  const sort = ["date", "date-desc", "newest"].includes(url.searchParams.get("sort") ?? "") ? url.searchParams.get("sort")! : "date";
  const search = url.searchParams.get("search") ?? "", category = Number(url.searchParams.get("category")) || 0;
  const asked = Number(url.searchParams.get("page")), page = Number.isSafeInteger(asked) && asked > 0 ? asked : 1;
  const write = await node.access() >= 2;
  const categoryRows = await node.db.query`SELECT * FROM page WHERE module = ${"cms.cont.event.category"} ORDER BY id DESC LIMIT ${100}`;
  const categories: { node: Node; title: string; write: boolean }[] = [];
  for (const row of categoryRows) {
    const item = await node.cms.node(Number(row.id), row);
    const access = await item.access();
    if (access < 2 && !await item.isReadable()) continue;
    categories.push({ node: item, title: (await item.showTitle()).plain(), write: access >= 2 });
  }
  if (Number.isSafeInteger(eventId) && eventId > 0) return detail(node, eventId, categories, ctx);
  const title = sqlSearch(search, ["tl.text"]).where;
  const order = sort === "newest" ? sql`p.id DESC`
    : sql`CASE WHEN p.event_start IS NULL THEN 1 ELSE 0 END, p.event_start ${sort === "date-desc" ? sql`DESC` : sql`ASC`}, p.id DESC`;
  const query = sql`SELECT p.* FROM (SELECT p.* ${sort !== "newest" ? sql`, (SELECT MIN(e.${sql.id("start")}) FROM cms_event e WHERE e.node_id = p.id) AS event_start` : sql``}
    FROM page p WHERE p.module = ${"cms.cont.event"}
    ${search ? sql`AND EXISTS (SELECT 1 FROM text_lang tl WHERE tl.text_id = p.title_id AND ${title})` : sql``}
    ${category ? sql`AND p.basis = ${category}` : sql``}
    ) p ORDER BY ${order} LIMIT ${PER_PAGE + 1} OFFSET ${(page - 1) * PER_PAGE}`;
  const rows = await overview(node.db, query, order);
  const items = [];
  for (const entry of rows.slice(0, PER_PAGE)) {
    const { row } = entry;
    const item = await node.cms.node(Number(row.id), row);
    const access = await item.access();
    if (access < 2 && !await item.isReadable()) continue;
    items.push({ ...entry, node: item, write: write && access >= 2, admin: write && access >= 3 });
  }
  const missing = [...new Set([category, ...items.map((item) => Number(item.node.vs.basis))])]
    .filter((id) => id && !categories.some((item) => item.node.id === id));
  if (missing.length) {
    const rows = await node.db.query`SELECT * FROM page WHERE module = ${"cms.cont.event.category"} AND ${sql.in("id", missing)}`;
    for (const row of rows) {
      const item = await node.cms.node(Number(row.id), row), access = await item.access();
      if (access < 2 && !await item.isReadable()) continue;
      categories.push({ node: item, title: (await item.showTitle()).plain(), write: access >= 2 });
    }
  }
  const link = (params: Record<string, unknown>) => backend.toUrl(self, {
    ...(search && { search }), ...(category && { category }), ...(sort !== "date" && { sort }), ...params,
  });
  const list = html.async`    <div style="padding:0;overflow:auto" tabindex=0 role=region aria-label="${t`Events`}">
    <table class=u2-table style="padding:0">
      <thead><tr>
        <th scope=col>${t`Title`}</th>
        <th scope=col>${t`Dates`}</th>
        <th scope=col>${t`Category`}</th>
        <th scope=col>${t`Visibility`}</th>
        <th scope=col>${t`Actions`}</th>
      </tr></thead>
      <tbody>${items.map(async ({ node: item, admin, period }) => html.async`<tr u2-href>
        <th scope=row><a href="${link({ event: item.id })}">${item.showTitle()}</a>${item.settings.address_locality() ? html`<br><small>${item.settings.address_locality()}</small>` : ""}</th>
        <td>${period ? formatDates([period], ctx.lang, String(item.settings.time_zone() ?? "UTC")) : html.async`<span>${t`No date yet`}</span>`}</td>
        <td>${categories.find((c) => c.node.id === Number(item.vs.basis))?.title || await t`Unassigned`}</td>
        <td><span data-event-access="${item.id}">${item.vs.access === null ? t`Inherited` : Number(item.vs.access) === 0 ? t`Private` : t`Explicit access`}</span>
          ${admin ? html.async`<br><button class=u2-unstyle type=button data-event-visibility="${item.id}" data-inherit="${item.vs.access === null ? "false" : "true"}">${item.vs.access === null ? t`Make private` : t`Inherit category access`}</button>` : ""}
        </td>
        <td><a href="${item.url()}">${t`Open page`}</a></td>
      </tr>`)}</tbody>
    </table></div>
    ${!items.length ? html.async`<p>${t`No entries found.`}</p>` : ""}
    <nav aria-label="${t`Result pages`}">
      ${page > 1 ? html.async`<a href="${link({ page: page - 1 })}">${t`Previous`}</a>` : ""}
      ${rows.length > PER_PAGE ? html.async`<a href="${link({ page: page + 1 })}">${t`Next`}</a>` : ""}
    </nav>`;
  if (listOnly) return list;
  const targets = categories.filter((item) => item.write);
  return html.async`<div class="u2-card cms-events">
    <div class=-head>${t`Events`}</div>
    <form data-event-filter class=u2-flex method=get action="${self}">${backend.toFields(self)}
      <input type=search name=search value="${search}" aria-label="${t`Title`}" placeholder="${t`Title`}">
      <select name=category aria-label="${t`Category`}"><option value="">${t`All categories`}</option>${categories.map((item) => html`<option value="${item.node.id}" ${category === item.node.id ? html`selected` : ""}>${item.title}</option>`)}</select>
      <select name=sort aria-label="${t`Sort`}">${[["date", t`Date ascending`], ["date-desc", t`Date descending`], ["newest", t`Recently added`]].map(([value, label]) => html.async`<option value="${value}" ${sort === value ? html`selected` : ""}>${label}</option>`)}</select>
      <a href="${backend.toUrl(self)}">${t`Reset`}</a>
    </form>
    ${write && targets.length ? html.async`<details><summary>${t`Add event`}</summary><form data-event-create class=u2-flex>
      <label>${t`Category`}<select name=parent required>${targets.map((item) => html.async`<option value="${item.node.id}">${item.title}</option>`)}</select></label>
      <label>${t`Title`}<input name=title required></label>
      <button type=submit>${t`Add event`}</button>
    </form></details>` : ""}
    ${!categories.length ? html.async`<p>${t`Add a category to a content page first.`}</p>` : ""}
    <p role=status></p>
    <div cms-part=list style="padding:0">${list}</div>
  </div>`;
}

export function list(node: Node, options: { ctx: Ctx; vars?: Record<string, unknown> }) {
  return render(node, { ...options, listOnly: true });
}
