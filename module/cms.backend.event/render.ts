import { AccessError, html, sql, sqlSearch } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const PER_PAGE = 50;

export default async function (node: Node, { ctx }: { ctx: Ctx }) {
  if (!await node.isReadable()) throw new AccessError();
  const t = node.app.t.in("cms.backend.event"), url = ctx.req.url.toURL();
  const self = await (await node.page()).url();
  const categoriesView = url.searchParams.get("view") === "categories";
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
  const title = sqlSearch(search, ["tl.text"]).where;
  const rows = await node.db.query`SELECT p.* FROM page p WHERE p.module = ${categoriesView ? "cms.cont.event.category" : "cms.cont.event"}
    ${search ? sql`AND EXISTS (SELECT 1 FROM text_lang tl WHERE tl.text_id = p.title_id AND ${title})` : sql``}
    ${!categoriesView && category ? sql`AND p.basis = ${category}` : sql``}
    ORDER BY p.id DESC LIMIT ${PER_PAGE + 1} OFFSET ${(page - 1) * PER_PAGE}`;
  const items = [];
  for (const row of rows.slice(0, PER_PAGE)) {
    const item = await node.cms.node(Number(row.id), row);
    const access = await item.access();
    if (access < 2 && !await item.isReadable()) continue;
    items.push({ node: item, write: write && access >= 2, admin: write && access >= 3 });
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
  const counts = items.length && !categoriesView ? await node.db.indexCol`SELECT node_id, COUNT(*) FROM cms_event
    WHERE ${sql.in("node_id", items.map((item) => item.node.id))} GROUP BY node_id` : new Map();
  const containers = [];
  if (write && categoriesView) {
    const modules = node.app.modules.linked().filter((mod) => mod.plugin.cms?.node?.settingsSchema?.properties?.["default module"]).map((mod) => mod.name);
    const rows = modules.length ? await node.db.query`SELECT * FROM page WHERE type = ${"c"} AND ${sql.in("module", modules)} ORDER BY id LIMIT ${100}` : [];
    for (const row of rows) {
      const item = await node.cms.node(Number(row.id), row);
      if (await item.access() >= 2) containers.push({ node: item, title: `${(await (await item.page()).showTitle()).plain()} · ${(await item.showTitle()).plain() || item.vs.name || item.id}` });
    }
  }
  const link = (params: Record<string, unknown>) => backend.toUrl(self, {
    view: categoriesView ? "categories" : "events", search, ...(!categoriesView && category && { category }), ...params,
  });
  const editUrl = async (item: Node) => {
    const url = new URL(await item.url(), ctx.req.url.href);
    url.searchParams.set("cms_editmode", "1");
    return url.href;
  };
  const targets = categoriesView ? containers : categories.filter((item) => item.write);
  return html.async`<div class=u2-card>
    <div class=-head>${t`Events`}</div>
    <nav aria-label="${t`Event management`}">
      <a href="${link({ view: "events", category: "", search: "" })}">${t`Events`}</a>
      <a href="${link({ view: "categories", category: "", search: "" })}">${t`Categories`}</a>
    </nav>
    <form method=get action="${self}">${backend.toFields(self)}
      <input type=hidden name=view value="${categoriesView ? "categories" : "events"}">
      <input type=search name=search value="${search}" aria-label="${t`Title`}" placeholder="${t`Title`}">
      ${!categoriesView ? html.async`<select name=category aria-label="${t`Category`}"><option value="">${t`All categories`}</option>${categories.map((item) => html`<option value="${item.node.id}" ${category === item.node.id ? html`selected` : ""}>${item.title}</option>`)}</select>` : ""}
      <button type=submit>${t`Filter`}</button>
    </form>
    ${write && targets.length ? html.async`<form data-event-create>
      ${categoriesView ? html`<input type=hidden name=category value=1>` : ""}
      <label>${categoriesView ? t`Content list` : t`Category`}<select name=parent required>${targets.map((item) => html.async`<option value="${item.node.id}">${item.title}</option>`)}</select></label>
      <label>${t`Title`}<input name=title required></label>
      <button type=submit>${categoriesView ? t`Add category` : t`Add event`}</button>
    </form>` : ""}
    ${!categoriesView && !categories.length ? html.async`<p>${t`Add a category to a content page first.`}</p>` : ""}
    <p role=status></p>
    <div style="overflow:auto" tabindex=0 role=region aria-label="${categoriesView ? t`Categories` : t`Events`}">
    <table class=u2-table>
      <thead><tr>
        <th scope=col>${t`Title`}</th>
        ${!categoriesView ? html.async`<th scope=col>${t`Category`}</th><th scope=col>${t`Blocks`}</th><th scope=col>${t`Visibility`}</th>` : ""}
        <th scope=col>${t`Actions`}</th>
      </tr></thead>
      <tbody>${items.map(async ({ node: item, write, admin }) => html.async`<tr>
        <th scope=row><a href="${item.url()}">${item.showTitle()}</a></th>
        ${!categoriesView ? html.async`<td>${write ? html.async`<form data-event-move>
          <input type=hidden name=event value="${item.id}">
          <select name=category aria-label="${t`Category`}" required><option value="">${t`Unassigned`}</option>${categories.filter((c) => c.write).map((c) => html`<option value="${c.node.id}" ${Number(item.vs.basis) === c.node.id ? html`selected` : ""}>${c.title}</option>`)}</select>
          <button type=submit>${t`Move`}</button>
        </form>` : categories.find((c) => c.node.id === Number(item.vs.basis))?.title ?? ""}</td>
        <td>${counts.get(item.id) ?? counts.get(String(item.id)) ?? 0}</td>
        <td>${Number(item.vs.access) === 0 && item.vs.access !== null ? t`Private` : t`Inherited / shared`}</td>` : ""}
        <td>${categoriesView ? html.async`<a href="${link({ view: "events", category: item.id, search: "" })}">${t`Events`}</a> ` : ""}${write ? html.async`<a href="${editUrl(item)}">${t`Edit`}</a>${!categoriesView && admin ? html.async` <button type=button data-event-visibility="${item.id}" data-inherit="${item.vs.access === null ? "false" : "true"}">${item.vs.access === null ? t`Make private` : t`Inherit category access`}</button>` : ""}` : ""}</td>
      </tr>`)}</tbody>
    </table></div>
    ${!items.length ? html.async`<p>${t`No entries found.`}</p>` : ""}
    <nav aria-label="${t`Result pages`}">
      ${page > 1 ? html.async`<a href="${link({ page: page - 1 })}">${t`Previous`}</a>` : ""}
      ${rows.length > PER_PAGE ? html.async`<a href="${link({ page: page + 1 })}">${t`Next`}</a>` : ""}
    </nav>
  </div>`;
}
