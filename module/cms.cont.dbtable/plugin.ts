// A database table as a list: search, filters, order, pages, edit in place, details, new rows,
// copy, delete, export. The table, its fields (along references into other tables too) and what
// each field allows are set in the node's widget.
import { csv, getCtx, header, hee, html, isTrustedOrigin, Output, safeEqual, sql } from "@qino/qino";
import { cms as cmsOf } from "@qino/qino/cms";
import * as u2 from "@qino/qino/u2";

import { columns, parentOf, placeholder, Query, setState, state, typeOf } from "./lib/query.ts";
import { show, toDb, TYPES } from "./lib/types.ts";

import type { App, Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Field } from "./lib/query.ts";

const NAME = "cms.cont.dbtable";

const flag = (description: string) => ({ type: "boolean", description });
const settingsSchema = {
  properties: {
    table: { type: "string", description: "The table listed." },
    where: { type: "string", description: "An SQL condition every row of the list meets (trusted: only editors set it)." },
    limit: { type: "integer", default: 20, description: "Rows per page." },
    order: { type: "string", description: "Default order: field names, each optionally followed by DESC, separated by comma." },
    search: { type: "string", description: "Search text a user starts with." },
    search_reset: flag("Each visit starts with the default search."),
    delete: flag("Rows can be deleted."),
    copy: flag("Rows can be copied."),
    export: flag("The list can be downloaded as CSV."),
    detail_page: { type: "string", description: "Page (id or URL) a row links to, with its key as `?id=`." },
    field_order: { type: "string", description: "Comma-separated field names defining their order." },
    fields: {
      description: "The fields, keyed by name.",
      additionalProperties: {
        properties: {
          path: { type: "string", description: "The column; along references `ref_id.column`. Default: the name." },
          type: { type: "string", enum: TYPES, description: "How it shows and is edited. Default: from the column." },
          list: flag("Shown in the list."),
          list_edit: flag("Editable in the list."),
          detail: flag("Shown in the details."),
          edit: flag("Editable in the details."),
          insert: flag("Asked for when adding a row."),
          search: flag("The search looks into it."),
          sort: flag("The list can be sorted by it."),
          filter: flag("Offers a filter."),
          fix: flag("Only rows with the default value; new rows get it. The field does not show."),
          default: { type: "string", description: "Value of a new row. `{user}`: the user, `{id}`: the page's `?id=`." },
          width: { type: "string", description: "Column width; a bare number is px." },
          link: { type: "string", description: "Page (id or URL) the value links to, as `?id=`." },
          choices: { type: "string", description: "For select: one per line, `value=Label` or just the value." },
          ref_label: { type: "string", description: "For reference: column or SQL expression naming the row pointed to (trusted)." },
          ref_where: { type: "string", description: "For reference: SQL condition on the rows offered (trusted)." },
          size: { type: "string", description: "For image: `width x height` in px, e.g. 30x20." },
          cut: { type: "integer", description: "For textarea: characters shown in the list." },
        },
      },
    },
  },
};

/** A user's search, order and filters per list. */
export const ctxSettingsSchema = { properties: { nodes: { additionalProperties: { type: "string" } } } };

const label = async (node: Node, f: Field) => (await node.showText(f.name + "_title")).plain().trim() || f.name;
const pageUrl = async (node: Node, link: string) => /^\d+$/.test(link) ? await (await node.cms.node(Number(link))).url() : link;
const withId = (url: string, id: unknown) => `${url}${url.includes("?") ? "&" : "?"}id=${encodeURIComponent(String(id ?? ""))}`;
const width = (v: string) => /^\d+(\.\d+)?$/.test(v.trim()) ? v.trim() + "px" : v.trim().replace(/[;{}<>"]/g, "");
const icon = (name: string, title: string) => `<u2-ico icon=${name} title="${hee(title)}">${hee(title)}</u2-ico>`;

/** The query as the current user narrowed it. */
const query = async (node: Node, ctx: Ctx, id?: unknown) => await Query.of(node, { user: await state(ctx, node), id: id ?? ctx.req.query.id });

async function list(node: Node, { ctx, vars }: { ctx: Ctx; vars: Record<string, unknown> }) {
  const q = await query(node, ctx, vars.id);
  if (!q) return "";
  const t = node.app.t, edit = await node.edit();
  const limit = Number(q.settings.limit) || 20, total = await q.count(node.db);
  const pages = Math.max(1, Math.ceil(total / limit)), page = Math.min(pages, Math.max(1, Number(vars.page) || 1));
  const fields = q.shown("list"), detailPage = String(q.settings.detail_page ?? "");
  const detailUrl = detailPage ? await pageUrl(node, detailPage) : "";
  const actions = [q.settings.delete && q.primary, q.settings.copy && q.primary?.autoIncrement, q.shown("detail").length, detailUrl].filter(Boolean).length;

  let head = "";
  for (const f of fields) {
    const text = await node.showText(f.name + "_title");
    const sort = f.is("sort") ? ` data-sort aria-sort=${q.sortedBy?.[0] === f.name ? (q.sortedBy[1] === "DESC" ? "descending" : "ascending") : "none"}` : "";
    const style = f.str("width") ? ` style="width:${width(f.str("width"))}"` : "";
    head += `<th data-f="${hee(f.name)}"${sort}${style}>` + (edit ? `<span contenteditable cmstxt=${text.id}>${text.plain().trim() ? text : hee(f.name)}</span>` : hee(text.plain().trim() || f.name));
  }
  if (actions) head += `<th colspan=${actions}>`;

  let body = "";
  for (const row of await q.rows(node.db, { limit, offset: (page - 1) * limit })) {
    body += `<tr data-row="${hee(String(row.__id))}">`;
    for (const f of fields) {
      const cell = await show(f, row[f.name], node.app, f.is("edit") && f.is("list_edit"));
      body += "<td>" + (f.str("link") ? `<a href="${hee(withId(await pageUrl(node, f.str("link")), row[f.name]))}">${cell}</a>` : cell);
    }
    if (q.settings.delete && q.primary) body += `<td class=-action data-do=delete>${icon("delete", await t`Delete`)}`;
    if (q.settings.copy && q.primary?.autoIncrement) body += `<td class=-action data-do=copy>${icon("content_copy", await t`Copy`)}`;
    if (q.shown("detail").length) body += `<td class=-action data-do=detail>${icon("info", await t`Details`)}`;
    if (detailUrl) body += `<td class=-action><a href="${hee(withId(detailUrl, row.__id))}">${icon("open_in_new", await t`Open`)}</a>`;
  }
  return html.raw(`<div class=-scroll><table class=u2-table>
	<thead><tr>${head}
	<tbody>${body}
</table></div>
<div class=-pager data-page=${page} data-limit=${limit} data-total=${total}${pages < 2 ? " hidden" : ""}>
	<button type=button class=-prev${page < 2 ? " disabled" : ""}>‹</button>
	<span>${page} / ${pages}</span>
	<button type=button class=-next${page >= pages ? " disabled" : ""}>›</button>
	<span class=-total>${total}</span>
</div>`);
}

/** One row with its detail fields; `index` counts in the list's current order. */
async function detail(node: Node, { ctx, vars }: { ctx: Ctx; vars: Record<string, unknown> }) {
  const q = await query(node, ctx, vars.id);
  if (!q) return "";
  const index = Math.max(0, Number(vars.index) || 0), total = await q.count(node.db);
  const [row] = await q.rows(node.db, { limit: 1, offset: index });
  if (!row) return "";
  let fields = "";
  for (const f of q.shown("detail")) {
    fields += `<tr><th>${hee(await label(node, f))}<td>${await show(f, row[f.name], node.app, f.is("edit"))}`;
  }
  return html.raw(`<table class=u2-table data-row="${hee(String(row.__id))}" data-index=${index} data-total=${total}>${fields}</table>`);
}

/** The fields asked for when adding a row, with their defaults. */
async function insert(node: Node, { ctx, vars }: { ctx: Ctx; vars: Record<string, unknown> }) {
  const q = await query(node, ctx, vars.id);
  if (!q) return "";
  let fields = "";
  for (const f of q.shown("insert")) {
    if (!f.own) continue;
    fields += `<tr><th>${hee(await label(node, f))}<td>${await show(f, placeholder(f.str("default"), vars.id), node.app, true)}`;
  }
  return html.raw(`<table class=u2-table>${fields}</table>`);
}

async function render(node: Node, { ctx }: { ctx: Ctx }) {
  u2.assets(ctx, ["class/table/table.css", "class/card/card.css", "el/ico/ico.js", "el/ico/ico.css"]);
  if (await node.settings.search_reset) await setState(ctx, node, (s) => delete s.search);
  const q = await query(node, ctx);
  const t = node.app.t;
  if (!q) return html.async`<div class=u2-card><div>${t`Choose the table in the widget.`}</div></div>`;
  const user = await state(ctx, node);

  let filters = "";
  for (const f of q.shown("filter")) {
    const value = user.filters?.[f.name] ?? "";
    const values = await q.values(node.db, f, 30);
    const name = hee(await label(node, f));
    filters += values
      ? `<label>${name} <select data-filter="${hee(f.name)}"><option value="">${hee(await t`all`)}${values.map((v) =>
        `<option${String(v ?? "") === value ? " selected" : ""}>${hee(String(v ?? ""))}`).join("")}</select></label>`
      : `<label>${name} <input type=${f.type === "date" ? "date" : "search"} data-filter="${hee(f.name)}" value="${hee(value)}"></label>`;
  }
  const search = q.shown("search").length
    ? html`<input type=search class=-search placeholder="${await t`search`}…" value="${user.search ?? String(q.settings.search ?? "")}">` : "";
  const exportUrl = ctx.req.url.toURL();
  exportUrl.search = "";
  exportUrl.searchParams.set("dbtable_export", String(node.id));
  if (ctx.req.query.id) exportUrl.searchParams.set("id", String(ctx.req.query.id));

  return html.async`<div class=u2-card data-id="${String(ctx.req.query.id ?? "")}">
	${node.cms.text(node, "title", { tag: "h2", class: "-head" })}
	<div class=-tools>
		${search}
		${html.raw(filters)}
		${q.shown("insert").some((f) => f.own) ? html.async`<button type=button class=-new>${t`New`}</button>` : ""}
		${q.settings.export ? html.async`<a href="${exportUrl.pathname + exportUrl.search}" download>${t`Export`}</a>` : ""}
	</div>
	<div cms-part=list>${list(node, { ctx, vars: {} })}</div>
</div>`;
}

/** What the list asks, and the widget. Who may see the list may use it, as the fields allow; the
 *  widget's questions need editing rights. */
async function api(node: Node, vars: Record<string, unknown>) {
  const app = node.app, db = node.db, ctx = getCtx();
  if (["tables", "table", "columns", "add", "remove", "sql"].includes(String(vars.do))) return await widgetApi(node, vars);

  const q = await Query.of(node, { id: vars.id });
  if (!q) return { error: "not configured" };
  const field = (name: unknown) => q.fields.get(String(name));
  const key = q.primary ? sql.id(q.primary.name) : undefined;
  // a row is only touched while the list reaches it
  const reached = async () => key && await q.row(db, vars.row);

  switch (vars.do) {
    case "update": {
      const f = field(vars.field);
      if (!f?.own || !f.is("edit") || !await reached()) return { error: "not editable" };
      const value = toDb(f, String(vars.value ?? ""));
      if (value !== undefined) await db.query`UPDATE ${sql.id(q.table)} SET ${sql.id(f.column.name)} = ${value} WHERE ${key} = ${vars.row}`;
      const row = await q.row(db, vars.row);
      return { value: row?.[f.name] };
    }
    case "clear": {
      const f = field(vars.field);
      if (!f?.own || !f.is("edit") || !["image", "file"].includes(f.type) || !await reached()) return { error: "not editable" };
      const old = await db.one`SELECT ${sql.id(f.column.name)} FROM ${sql.id(q.table)} WHERE ${key} = ${vars.row}`;
      if (Number(old)) await (await app.dbFiles.file(Number(old))).remove();
      await db.query`UPDATE ${sql.id(q.table)} SET ${sql.id(f.column.name)} = ${f.column.nullable ? null : 0} WHERE ${key} = ${vars.row}`;
      return { done: true };
    }
    case "insert": {
      const values: Record<string, unknown> = {};
      for (const f of q.fields.values()) {
        if (!f.own) continue;
        if (f.is("fix")) values[f.column.name] = placeholder(f.str("default"), vars.id);
        else if (f.is("insert") && f.str("default")) values[f.column.name] = toDb(f, String(placeholder(f.str("default"), vars.id)));
      }
      for (const [name, v] of Object.entries((vars.values ?? {}) as Record<string, unknown>)) {
        const f = field(name);
        if (!f?.own || !f.is("insert") || f.is("fix")) continue;
        const value = toDb(f, String(v ?? ""));
        if (value !== undefined) values[f.column.name] = value;
      }
      return { id: await db.table(q.table).insert(values) };
    }
    case "copy": {
      if (!q.settings.copy || !q.primary?.autoIncrement || !await reached()) return { error: "not copyable" };
      const { [q.primary.name]: _, ...copy } = (await db.row`SELECT * FROM ${sql.id(q.table)} WHERE ${key} = ${vars.row}`)!;
      return { id: await db.table(q.table).insert(copy) };
    }
    case "delete": {
      if (!q.settings.delete || !await reached()) return { error: "not deletable" };
      await db.query`DELETE FROM ${sql.id(q.table)} WHERE ${key} = ${vars.row}`;
      return { done: true };
    }
    case "order": {
      const f = field(vars.field);
      if (!f?.is("sort")) return { error: "not sortable" };
      const current = (await Query.of(node, { user: await state(ctx, node), id: vars.id }))?.sortedBy;
      const dir = current?.[0] === f.name && current[1] === "ASC" ? "DESC" : "ASC";
      await setState(ctx, node, (s) => s.order = `${f.name} ${dir}`);
      return { order: dir };
    }
    case "search":
      await setState(ctx, node, (s) => s.search = String(vars.value ?? ""));
      return { done: true };
    case "filter": {
      if (!field(vars.field)?.is("filter")) return { error: "no filter" };
      await setState(ctx, node, (s) => (s.filters ??= {})[String(vars.field)] = String(vars.value ?? ""));
      return { done: true };
    }
  }
  return { error: "unknown action" };
}

/** The widget's questions: tables, their columns (with where references lead), adding and removing
 *  fields, and the resulting SQL. */
async function widgetApi(node: Node, vars: Record<string, unknown>) {
  if (await node.access() < 2) return { error: "no access" };
  const app = node.app, tables = await app.db.listTables();
  switch (vars.do) {
    case "tables":
      return { tables, types: TYPES };
    case "table": {
      // the fields were columns of the old table: they go, their labels with them
      const table = String(vars.table ?? "");
      if (table && !tables.includes(table)) return { error: "unknown table" };
      for (const name of Object.keys(JSON.parse(String(node.vs.settings || "{}")).fields ?? {})) await node.textDelete(name + "_title");
      node.settings.fields({});
      await node.settings.field_order("");
      await node.settings.table(table);
      return { table };
    }
    case "columns": {
      const table = String(vars.table ?? "");
      if (!tables.includes(table)) return { error: "unknown table" };
      return {
        columns: (await columns(app, table)).map((c) => ({ name: c.name, type: c.type, primary: c.primary, parent: parentOf(app, table, c.name, tables) })),
      };
    }
    case "add": {
      // `path` from the listed table along references; its name: the column's, made unique
      const path = String(vars.path ?? "");
      const fields = node.settings.fields;
      const q = await Query.of(node);
      if (!q || !/^\w+(\.\w+)*$/.test(path)) return { error: "invalid path" };
      let table = q.table;
      const parts = path.split(".");
      for (const ref of parts.slice(0, -1)) table = parentOf(app, table, ref, tables) ?? "";
      const column = (await columns(app, table)).find((c) => c.name === parts.at(-1));
      if (!column) return { error: "unknown column" };
      let name = parts.at(-1)!;
      for (let i = 2; name in fields; i++) name = `${parts.at(-1)}_${i}`;
      const own = parts.length === 1, type = typeOf(column);
      fields[name]({
        ...parts.length > 1 || name !== path ? { path } : {}, type,
        list: type !== "textarea", detail: true, edit: own && !column.primary, search: ["text", "textarea"].includes(type) || column.primary,
        sort: true,
      });
      const order = String(await node.settings.field_order ?? "");
      await node.settings.field_order(order ? `${order},${name}` : name);
      // the label is a text like any other, so it can be translated later
      await node.text(name + "_title", getCtx().lang, parts.at(-1));
      return { name };
    }
    case "remove": {
      const name = String(vars.name ?? "");
      delete node.settings.fields[name];
      const order = String(await node.settings.field_order ?? "").split(",").filter((n) => n && n !== name).join(",");
      await node.settings.field_order(order);
      await node.textDelete(name + "_title");
      return { name };
    }
    case "sql": {
      const q = await Query.of(node, { id: vars.id });
      if (!q) return { sql: "" };
      return { sql: q.select({ limit: Number(q.settings.limit) || 20 }).parts.map((p) =>
        "text" in p ? p.text : "id" in p ? `\`${p.id}\`` : JSON.stringify(p.param)).join("") };
    }
  }
}

/** A file for an image or file field (`?dbtable_upload=<node>&row=&field=&id=`, POST), and the list
 *  as CSV (`?dbtable_export=<node>&id=`). */
async function route(app: App, ctx: Ctx) {
  const upload = Number(ctx.req.query.dbtable_upload), exported = Number(ctx.req.query.dbtable_export);
  const id = upload || exported;
  if (!id) return;
  const node = await cmsOf(app).node(id);
  if (node.module?.name !== NAME || !await node.isReadable()) return;
  if (exported) {
    const q = await Query.of(node, { user: await state(ctx, node), id: ctx.req.query.id });
    if (!q?.settings.export) return;
    const fields = q.shown("list");
    const rows: unknown[][] = [await Promise.all(fields.map((f) => label(node, f)))];
    for (const r of await q.rows(node.db)) rows.push(fields.map((f) => r[f.name] ?? ""));
    const title = (await (await node.page()).showTitle()).plain() || "export";
    const day = new Date().toISOString().slice(0, 10);
    throw new Output(csv(rows), { headers: [["Content-Type", "text/csv; charset=utf-8"], header.contentDisposition("attachment", `${title}_${day}.csv`)] });
  }

  if (ctx.req.method !== "POST") return;
  if (!isTrustedOrigin(ctx.req) || !safeEqual(ctx.req.headers.get("x-csrf-token") ?? "", ctx.csrfToken)) throw new Output("csrf", { status: 403 });
  const q = await Query.of(node, { id: ctx.req.query.id });
  const f = q?.fields.get(String(ctx.req.query.field)), file = await ctx.req.files.file;
  // only a row the list reaches
  if (!q || !f?.own || !f.is("edit") || !["image", "file"].includes(f.type) || !file || !await q.row(node.db, ctx.req.query.row)) {
    throw new Output("not editable", { status: 403 });
  }
  const key = sql.id(q.primary!.name);
  const old = Number(await node.db.one`SELECT ${sql.id(f.column.name)} FROM ${sql.id(q.table)} WHERE ${key} = ${ctx.req.query.row}`);
  // the file keeps its id: whoever points to it still finds it
  const stored = old && await (await app.dbFiles.file(old)).exists() ? await app.dbFiles.file(old) : await app.dbFiles.add();
  await stored.replaceFromUpload(file);
  await stored.access(1); // shown in the list to whoever sees it
  await node.db.query`UPDATE ${sql.id(q.table)} SET ${sql.id(f.column.name)} = ${Number(stored.id)} WHERE ${key} = ${ctx.req.query.row}`;
  throw new Output("ok");
}

export function init(app: App, { signal }: { signal: AbortSignal }) {
  app.on("route", ({ ctx }: { ctx: Ctx }) => route(app, ctx), { signal });
}

export const cms = {
  node: {
    render,
    api,
    settingsSchema,
    parts: { list, detail, insert },
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    widget: "pub/widget.js",
  },
};
