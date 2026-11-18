import { AccessError, html, sql, sqlSearch } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { formatDates } from "@qino/qino/cms.cont.event";
import { overview, zoneOf } from "@qino/qino/cms.event";

import detail from "./detail.ts";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const PER_PAGE = 50;
const CATEGORY = "cms.cont.event.category";

/** Its image, small. */
async function thumbnail(node: Node) {
  const file = await node.cms.image(node);
  return file ? html`<img src="${await file.url({ w: 60, h: 40, max: true })}" width=60 alt="" loading=lazy>` : "";
}

/** Editors see offline nodes as well. */
const visible = async (node: Node) => await node.access() >= 2 || await node.isReadable();

/** The visible categories among the rows, with their picker title and whether events may be put there. */
async function categoriesOf(node: Node, rows: Record<string, string | number>[]) {
  const result: { node: Node; title: string; write: boolean }[] = [];
  for (const row of rows) {
    const item = await node.cms.node(Number(row.id), row);
    if (await visible(item)) result.push({ node: item, title: (await item.showTitle()).plain(), write: await item.access() >= 2 });
  }
  return result;
}

export default async function render(node: Node, { ctx, vars = {}, listOnly = false }: {
  ctx: Ctx; vars?: Record<string, unknown>; listOnly?: boolean;
}) {
  if (!await node.isReadable()) throw new AccessError();
  const t = node.app.t.in("cms.backend.event"), url = ctx.req.url.toURL();
  for (const key of ["search", "category", "sort", "page"]) if (key in vars) {
    if (vars[key]) url.searchParams.set(key, String(vars[key]));
    else url.searchParams.delete(key);
  }
  const q = (key: string) => url.searchParams.get(key) ?? "";
  const self = await (await node.page()).url();
  const sort = ["date-desc", "newest"].includes(q("sort")) ? q("sort") : "date";
  const search = q("search"), category = Number(q("category")) || 0;
  const asked = Number(q("page")), page = Number.isSafeInteger(asked) && asked > 0 ? asked : 1;
  // the picker's categories: a hundred, loaded where a page needs them
  const picker = async () => categoriesOf(node, await node.db.query`SELECT * FROM page WHERE module = ${CATEGORY} ORDER BY id DESC LIMIT ${100}`);
  const id = backend.id(url, vars);
  if (id) return detail(node, id, picker, ctx);
  const categories = await picker();
  const title = sqlSearch(search, ["tl.text"]).where;
  const order = sort === "newest" ? sql`p.id DESC`
    : sql`CASE WHEN p.event_start IS NULL THEN 1 ELSE 0 END, p.event_start ${sort === "date-desc" ? sql`DESC` : sql`ASC`}, p.id DESC`;
  // every node that is an event, whatever module shows it
  const query = sql`SELECT p.* FROM (SELECT p.* ${sort !== "newest" ? sql`, (SELECT MIN(d.${sql.id("start")}) FROM cms_event_date d WHERE d.event_id = p.id) AS event_start` : sql``}
    FROM page p JOIN cms_event ev ON ev.id = p.id
    WHERE ${search ? sql`EXISTS (SELECT 1 FROM text_lang tl WHERE tl.text_id = p.title_id AND ${title})` : sql`${true}`}
    ${category ? sql`AND p.basis = ${category}` : sql``}
    ) p ORDER BY ${order} LIMIT ${PER_PAGE + 1} OFFSET ${(page - 1) * PER_PAGE}`;
  const rows = await overview(node.db, query, order);
  const items = [];
  for (const entry of rows.slice(0, PER_PAGE)) {
    const item = await node.cms.node(Number(entry.row.id), entry.row);
    if (await visible(item)) items.push({ ...entry, node: item });
  }
  // the picker lists a hundred categories; add what this page shows beyond those, the parents of
  // events shown by other modules (a shop category of courses) too
  const missing = [...new Set([category, ...items.map((item) => Number(item.node.vs.basis))])]
    .filter((id) => id && !categories.some((item) => item.node.id === id));
  if (missing.length) categories.push(...await categoriesOf(node, await node.db.query`SELECT * FROM page WHERE ${sql.in("id", missing)}`));
  const link = (params: Record<string, unknown>) => backend.toUrl(self, {
    ...(search && { search }), ...(category && { category }), ...(sort !== "date" && { sort }), ...params,
  });
  const list = html.async`<div style="padding:0;overflow:auto" tabindex=0 role=region aria-label="${t`Events`}">
      <table class=u2-table style="padding:0">
        <thead><tr>
          <th scope=col>
          <th scope=col>${t`Title`}
          <th scope=col>${t`Dates`}
          <th scope=col>${t`Category`}
          <th scope=col>${t`Visibility`}
          <th scope=col>${t`Actions`}
        <tbody>${items.map(async ({ node: item, event, period }) => html.async`<tr u2-href>
          <td>${thumbnail(item)}
          <th scope=row><a href="${link({ id: item.id })}">${item.showTitle()}</a>${event.address_locality ? html`<br><small>${event.address_locality}</small>` : ""}</th>
          <td>${period ? formatDates([period], ctx.lang, await zoneOf(node.app, event)) : t`No date yet`}
          <td>${categories.find((c) => c.node.id === Number(item.vs.basis))?.title || t`Unassigned`}
          <td>${item.vs.access === null ? t`Inherited` : Number(item.vs.access) === 0 ? t`Private` : t`Explicit access`}
          <td><a href="${item.url()}">${t`Open page`}</a>`)}
      </table>
    </div>
    ${!items.length ? html.async`<p>${t`No entries found.`}</p>` : ""}
    <nav aria-label="${t`Result pages`}">
      ${page > 1 ? html.async`<a href="${link({ page: page - 1 })}">${t`Previous`}</a>` : ""}
      ${rows.length > PER_PAGE ? html.async`<a href="${link({ page: page + 1 })}">${t`Next`}</a>` : ""}
    </nav>`;
  if (listOnly) return list;
  const targets = await node.access() >= 2 ? categories.filter((item) => item.write && item.node.vs.module === CATEGORY) : [];
  return html.async`<div class="u2-card cms-events" style="flex:0 1 auto">
    <div class=-head>${t`Events`}</div>
    <form data-event-filter method=get action="${self}">${backend.toFields(self)}
      <input type=search name=search value="${search}" aria-label="${t`Title`}" placeholder="${t`Title`}">
      <select name=category aria-label="${t`Category`}"><option value="">${t`All categories`}</option>${categories.map((item) => html`<option value="${item.node.id}" ${category === item.node.id ? html`selected` : ""}>${item.title}</option>`)}</select>
      <select name=sort aria-label="${t`Sort`}">${[["date", t`Date ascending`], ["date-desc", t`Date descending`], ["newest", t`Recently added`]].map(([value, label]) => html.async`<option value="${value}" ${sort === value ? html`selected` : ""}>${label}</option>`)}</select>
    </form>
    ${targets.length ? html.async`<form data-event-create aria-label="${t`Add event`}">
      <select name=parent required aria-label="${t`Category`}">${targets.map((item) => html`<option value="${item.node.id}">${item.title}</option>`)}</select>
      <input name=title required placeholder="${t`Title`}" aria-label="${t`Title`}">
      <button type=submit><u2-ico icon=add>+</u2-ico> ${t`Add event`}</button>
    </form>` : ""}
    ${!categories.length ? html.async`<p>${t`Add a category to a content page first.`}</p>` : ""}
    <p role=status></p>
    <div cms-part=list style="padding:0">${list}</div>
  </div>`;
}

export function list(node: Node, options: { ctx: Ctx; vars?: Record<string, unknown> }) {
  return render(node, { ...options, listOnly: true });
}
