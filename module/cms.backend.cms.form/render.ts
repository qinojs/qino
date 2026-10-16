import { html, sql, sqlSearch, tableRef } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { backend } from "@qino/qino/cms.backend";
import { entryData, fields, SPAM, uploads as uploadsOf } from "@qino/qino/cms.cont.form";

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** How many entries one page of the table holds. */
const PER_PAGE = 50;

/** Forms this user may view — reading entries requires edit access to the form. */
export async function forms(app: App): Promise<Node[]> {
  const ids = await app.db.col<number>`
    SELECT id FROM ${sql.id(tableRef("page"))} WHERE module = ${"cms.cont.form"} ORDER BY id`;
  const mine = [];
  for (const id of ids) {
    const node = await cms(app).node(Number(id));
    if (node.exists() && await node.access() >= 2) mine.push(node);
  }
  return mine;
}

/**
 * A form's entries, searched and sorted. `sort` is a field name or "created".
 *
 * Search in SQL (LIKE over the json text); sorting and paging in JS, since JSON paths differ per
 * database. So all entries of a form are loaded — fine until a form has tens of thousands.
 */
export async function entries(app: App, node: Node, opt: {
  search?: string;
  sort?: string;
  dir?: string;
  page?: number;
  all?: boolean;
} = {}) {
  const sh = sqlSearch(String(opt.search ?? ""), ["data"]);
  const rows = await app.db.query`
    SELECT id, created, lang, spam, data FROM ${sql.id(tableRef("form_entry"))}
    WHERE node_id = ${node.id} AND ${sh.where} ORDER BY created DESC, id DESC`;

  // Values stay in `data`, so fields named `id` or `created` don't clash with the entry's columns.
  const all = rows.map((row) => ({
    id: Number(row.id),
    created: Number(row.created),
    lang: String(row.lang ?? ""),
    spam: Number(row.spam ?? 0),
    data: entryData(row.data),
  }));

  const dir = String(opt.dir).toUpperCase() === "ASC" ? 1 : -1;
  const sort = String(opt.sort ?? "created");
  if (sort === "created" || sort === "spam") all.sort((a, b) => dir * (a[sort] - b[sort] || a.id - b.id));
  else {
    // Numbers compare as numbers, everything else as text — the type a value was stored with.
    all.sort((a, b) => {
      const x = a.data[sort], y = b.data[sort];
      if (typeof x === "number" && typeof y === "number") return dir * (x - y);
      return dir * String(x ?? "").localeCompare(String(y ?? ""));
    });
  }

  const from = opt.all ? 0 : Math.max(0, Number(opt.page ?? 0)) * PER_PAGE;
  return { total: all.length, rows: opt.all ? all : all.slice(from, from + PER_PAGE) };
}

/** What the transformer can turn into an image: pictures, and a PDF's first page. */
const previewable = (mime: unknown) => String(mime ?? "").startsWith("image/") || mime === "application/pdf";

/**
 * Uploads of these entries, keyed `<entry>:<field>`, in one query. Links are signed for this
 * session only — uploads are not public.
 */
async function uploads(app: App, ids: number[]) {
  const out = new Map<string, HtmlString[]>();
  for (const [key, files] of await uploadsOf(app, ids)) {
    out.set(key, await Promise.all(files.map(async ({ id, name, mime }) => {
      const file = await app.dbFiles.file(id);
      const download = await file.url({ dl: true, grant: "session" });
      const preview = previewable(mime) ? await file.url({ fmt: "avif", w: 60, h: 60, max: true, grant: "session" }) : "";
      return html`<a href="${download}" download title="${name}">${
        preview ? html`<img src="${preview}" alt="${name}" loading=lazy>` : html`<u2-ico inline icon=download>↓</u2-ico> ${name}`
      }</a> `;
    })));
  }
  return out;
}

const percent = (score: number) => Math.round(score * 100) + "%";
const date = (unix: unknown) => new Date(Number(unix) * 1000).toISOString().slice(0, 16).replace("T", " ");

/**
 * A form's table. Form, search, sort, page and writes come as vars; `formOfVars()` already checked
 * write access.
 */
export async function list(node: Node, { vars = {} }: { vars?: Record<string, unknown> } = {}): Promise<HtmlString> {
  const app = node.app;
  const { t } = app;
  const form = await formOfVars(app, vars);
  if (!form) return html`<tbody><tr><td>${await t`No form selected.`}</tbody>`;

  if (vars.save) await save(app, form, vars.save as Record<string, string>);
  if (vars.delete) await remove(app, form, Number(vars.delete));

  const page = Number(vars.page ?? 0);
  const { rows, total } = await entries(app, form, { ...vars, page });
  const label = await fields(form, rows), names = [...label.keys()];

  const sort = String(vars.sort ?? "created");
  const dir = String(vars.dir ?? "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const head = (name: string, caption: string) => html`
      <th data-sort="${name}" data-dir="${sort === name && dir === "desc" ? "asc" : "desc"}" style="cursor:pointer">
        ${caption}${sort === name ? html.raw(dir === "asc" ? " ▲" : " ▼") : ""}`;

  const files = await uploads(app, rows.map((row) => row.id));
  const cells = (row: { id: number; data: Record<string, unknown> }) =>
    names.map((name) => {
      const sent = files.get(`${row.id}:${name}`);
      // An upload is not a value one corrects — it is a file one looks at or takes away.
      return sent ? html`<td>${sent}` : html`<td><input data-field="${name}" value="${row.data[name]}" size=12>`;
    });

  return html.async`<thead><tr>
      ${head("created", await t`Received`)}
      ${head("spam", await t`Spam`)}
      ${names.map((name) => head(name, label.get(name)!))}
      <th>
    </tr></thead>
    <tbody>
      ${rows.map((row) =>
    html.async`<tr data-entry="${row.id}">
        <td>${date(row.created)}
        <td class=-num>${row.spam >= SPAM ? html`<u2-ico inline icon=report>⚠</u2-ico> ` : ""}${percent(row.spam)}
        ${cells(row)}
        <td><button class=u2-unstyle data-delete="${row.id}" u2-confirm="${t`Delete entry?`}"><u2-ico icon=delete>✕</u2-ico></button>`
  )}
      ${!rows.length ? html.async`<tr><td colspan="${names.length + 3}">${t`No entries.`}` : ""}
    </tbody>
    <tfoot><tr>
      <td colspan="${names.length + 3}">
        ${total} ${t`entries`}
        ${total > PER_PAGE
    ? html`
          <button data-page="${Math.max(0, page - 1)}" ${page ? "" : html.raw("disabled")}>←</button>
          ${page + 1} / ${Math.ceil(total / PER_PAGE)}
          <button data-page="${page + 1}" ${(page + 1) * PER_PAGE < total ? "" : html.raw("disabled")}>→</button>`
    : ""}
    </tfoot>`;
}

/** Correct one value of an entry. Numbers stay numbers, so sorting still works. */
async function save(app: App, form: Node, vs: Record<string, string>) {
  const id = Number(vs.id);
  const row = await app.db.row`
    SELECT data FROM ${sql.id(tableRef("form_entry"))} WHERE id = ${id} AND node_id = ${form.id}`;
  if (!row) return; // an entry of another form is none of this table's business
  const data = entryData(row.data);
  const old = data[vs.field];
  data[vs.field] = typeof old === "number" && vs.value !== "" && !isNaN(Number(vs.value)) ? Number(vs.value) : String(vs.value);
  await app.db.table("form_entry").update(id, { data: JSON.stringify(data) });
}

/** Throw one entry away. Its files hang on it and go along. */
async function remove(app: App, form: Node, id: number) {
  const own = await app.db.one`
    SELECT id FROM ${sql.id(tableRef("form_entry"))} WHERE id = ${id} AND node_id = ${form.id}`;
  if (own) await app.db.table("form_entry").delete(id);
}

/** The form a request talks about, if the user may see it. */
export async function formOfVars(app: App, vars: Record<string, unknown>): Promise<Node | undefined> {
  const id = Number(vars.form ?? 0);
  if (!id) return (await forms(app))[0];
  const node = await cms(app).node(id);
  if (!node.exists() || node.vs.module !== "cms.cont.form" || await node.access() < 2) return;
  return node;
}

/**
 * A form in the picker: where it sits (as in the history) and its number of entries. Picking one is
 * a link, so a form's entries can be linked to.
 */
export async function formLine(app: App, node: Node, active: boolean): Promise<HtmlString> {
  const count = await app.db.one`
    SELECT count(*) FROM ${sql.id(tableRef("form_entry"))} WHERE node_id = ${node.id}`;
  return html.async`<tr${active ? html.raw(" class=-active") : ""}>
      <td><a href="?form=${node.id}"${active ? html.raw(" aria-current=page") : ""}>${Number(count)} ${app.t`entries`}</a>
      <td class=-where>${backend.breadcrumb(node, node.id)}`;
}

/** The export of what the table currently shows — the search included, the paging not. */
export async function exportRows(app: App, node: Node, search: string): Promise<unknown[][]> {
  const { rows } = await entries(app, node, { search, sort: "created", dir: "asc", all: true });
  const label = await fields(node, rows), names = [...label.keys()];
  const files = await uploadsOf(app, rows.map((row) => row.id));
  const attached = (id: number, name: string) => files.get(`${id}:${name}`)?.map((f) => f.name);
  return [
    [await app.t`Received`, await app.t`Spam`, ...label.values()],
    ...rows.map((row) => [date(row.created), percent(row.spam), ...names.map((n) => attached(row.id, n) ?? row.data[n])]),
  ];
}
