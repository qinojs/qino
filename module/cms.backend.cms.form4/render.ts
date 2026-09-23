import { html, sql, sqlSearch, tableRef } from "@qino/qino";
import { cms } from "@qino/qino/cms";

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** How many entries one page of the table holds. */
const PER_PAGE = 50;

/** Forms this user may view — reading entries requires edit access to the form. */
export async function forms(app: App): Promise<Node[]> {
  const ids = await app.db.col<number>`
    SELECT id FROM ${sql.id(tableRef("page"))} WHERE module = ${"cms.cont.form4"} ORDER BY id`;
  const mine = [];
  for (const id of ids) {
    const node = await cms(app).node(Number(id));
    if (node.exists() && await node.access() >= 2) mine.push(node);
  }
  return mine;
}

/** The page a form sits on — its title is what makes the form recognisable in the list. */
async function pageOf(node: Node): Promise<Node | undefined> {
  const path = [...(await node.path()).values()].reverse();
  return path.find((n) => n.vs.type === "p");
}

/**
 * The form's columns: its fields in order, plus fields only found in entries (deleted later),
 * so their values stay visible.
 */
export async function columns(node: Node, rows: { data: Record<string, unknown> }[]): Promise<string[]> {
  const fields = (await node.conts()).find((c) => c.vs.module === "cms.cont.form4.fields");
  const declared = fields ? Object.keys(fields.settings.fields) : [];
  const sorted = String(fields?.settings.sort() ?? "").split(",").filter((n) => declared.includes(n));
  const names = [...sorted, ...declared.filter((n) => !sorted.includes(n))];
  for (const row of rows) for (const name of Object.keys(row.data)) if (!names.includes(name)) names.push(name);
  return names;
}

/** The labels of a form's fields, for the table head and the export. */
export async function labels(node: Node): Promise<Record<string, string>> {
  const fields = (await node.conts()).find((c) => c.vs.module === "cms.cont.form4.fields");
  const labels: Record<string, string> = {};
  if (!fields) return labels;
  for (const name of Object.keys(fields.settings.fields)) {
    const label = (await fields.showText(name + "_title")).plain();
    if (label) labels[name] = label;
  }
  return labels;
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
    SELECT id, created, lang, data FROM ${sql.id(tableRef("form4_entry"))}
    WHERE node_id = ${node.id} AND ${sh.where} ORDER BY created DESC, id DESC`;

  // Values stay in `data`, so fields named `id` or `created` don't clash with the entry's columns.
  const all = rows.map((row) => ({
    id: Number(row.id),
    created: Number(row.created),
    lang: String(row.lang ?? ""),
    data: parse(String(row.data ?? "")),
  }));

  const dir = String(opt.dir).toUpperCase() === "ASC" ? 1 : -1;
  const sort = String(opt.sort ?? "created");
  if (sort === "created") all.sort((a, b) => dir * (a.created - b.created || a.id - b.id));
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

function parse(json: string): Record<string, unknown> {
  try {
    const data = JSON.parse(json || "{}");
    return data && typeof data === "object" ? data : {};
  } catch {
    return {}; // a broken row shows empty rather than taking the table down
  }
}

/** What the transformer can turn into an image: pictures, and a PDF's first page. */
const previewable = (mime: unknown) => String(mime ?? "").startsWith("image/") || mime === "application/pdf";

/**
 * Uploads of these entries, keyed `<entry>:<field>`, in one query. Links are signed for this
 * session only — uploads are not public.
 */
async function uploads(app: App, ids: number[]): Promise<Map<string, HtmlString>> {
  const out = new Map<string, HtmlString>();
  if (!ids.length) return out;
  const rows = await app.db.query`
    SELECT ef.entry_id, ef.field, ef.file_id, f.name, f.mime
    FROM ${sql.id(tableRef("form4_entry_file"))} ef
    JOIN ${sql.id(tableRef("file"))} f ON f.id = ef.file_id
    WHERE ef.entry_id IN (${sql.join(ids.map((id) => sql`${id}`), ", ")}) ORDER BY ef.id`;

  for (const row of rows) {
    const file = await app.dbFiles.file(Number(row.file_id));
    const download = await file.url({ dl: true, grant: "session" });
    const preview = previewable(row.mime)
      ? await file.url({ fmt: "avif", w: 60, h: 60, max: true, grant: "session" })
      : "";
    const link = html`<a href="${download}" download title="${row.name}">${
      preview ? html`<img src="${preview}" alt="${row.name}" loading=lazy>` : html`<u2-ico inline icon=download>↓</u2-ico> ${row.name}`
    }</a> `;
    const key = `${row.entry_id}:${row.field}`;
    out.set(key, html`${out.get(key)}${link}`);
  }
  return out;
}

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
  const names = await columns(form, rows);
  const label = await labels(form);

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
      ${names.map((name) => head(name, label[name] || name))}
      <th>
    </tr></thead>
    <tbody>
      ${rows.map((row) =>
    html.async`<tr data-entry="${row.id}">
        <td>${date(row.created)}
        ${cells(row)}
        <td><button class=u2-unstyle data-delete="${row.id}" u2-confirm="${t`Delete entry?`}"><u2-ico icon=delete>✕</u2-ico></button>`
  )}
      ${!rows.length ? html`<tr><td colspan="${names.length + 2}">${await t`No entries.`}` : ""}
    </tbody>
    <tfoot><tr>
      <td colspan="${names.length + 2}">
        ${total} ${await t`entries`}
        ${total > PER_PAGE
    ? html`
          <button data-page="${Math.max(0, page - 1)}" ${page ? "" : html.raw("disabled")}>←</button>
          ${page + 1} / ${Math.ceil(total / PER_PAGE)}
          <button data-page="${page + 1}" ${(page + 1) * PER_PAGE < total ? "" : html.raw("disabled")}>→</button>`
    : ""}
    </tfoot>`;
}

/** Correct one value of an entry. Numbers stay numbers, so sorting still works. */
async function save(app: App, form: Node, vs: Record<string, string>): Promise<void> {
  const id = Number(vs.id);
  const row = await app.db.row`
    SELECT data FROM ${sql.id(tableRef("form4_entry"))} WHERE id = ${id} AND node_id = ${form.id}`;
  if (!row) return; // an entry of another form is none of this table's business
  const data = JSON.parse(String(row.data ?? "{}") || "{}");
  const old = data[vs.field];
  data[vs.field] = typeof old === "number" && vs.value !== "" && !isNaN(Number(vs.value)) ? Number(vs.value) : String(vs.value);
  await app.db.table("form4_entry").update(id, { data: JSON.stringify(data) });
}

/** Throw one entry away. Its files hang on it and go along. */
async function remove(app: App, form: Node, id: number): Promise<void> {
  const own = await app.db.one`
    SELECT id FROM ${sql.id(tableRef("form4_entry"))} WHERE id = ${id} AND node_id = ${form.id}`;
  if (own) await app.db.table("form4_entry").delete(id);
}

/** The form a request talks about, if the user may see it. */
export async function formOfVars(app: App, vars: Record<string, unknown>): Promise<Node | undefined> {
  const id = Number(vars.form ?? 0);
  if (!id) return (await forms(app))[0];
  const node = await cms(app).node(id);
  if (!node.exists() || node.vs.module !== "cms.cont.form4" || await node.access() < 2) return;
  return node;
}

/**
 * A form in the picker: name, page, number of entries. The block's title wins (a page may have two
 * forms).
 */
export async function formLine(app: App, node: Node, active: boolean): Promise<HtmlString> {
  const count = await app.db.one`
    SELECT count(*) FROM ${sql.id(tableRef("form4_entry"))} WHERE node_id = ${node.id}`;
  const page = await pageOf(node);
  const plain = async (n: Node) => (await n.showTitle()).plain();
  const title = await plain(node) || (page ? await plain(page) : "");
  const url = page ? await page.url() : "";
  return html.async`<tr${active ? html.raw(" class=-active") : ""}>
      <td><button class=u2-unstyle data-form="${node.id}">${title || html.raw(`#${node.id}`)}</button>
      <td>${url ? html`<a href="${url}" target=_blank title="${await app.t`Open the page`}"><u2-ico inline icon=open_in_new>↗</u2-ico></a>` : ""}
      <td>${Number(count)}`;
}

/** The export of what the table currently shows — the search included, the paging not. */
export async function csv(app: App, node: Node, search: string): Promise<string> {
  const { rows } = await entries(app, node, { search, sort: "created", dir: "asc", all: true });
  const names = await columns(node, rows);
  const label = await labels(node);
  // Every cell quoted, quotes doubled — the one escaping rule csv actually has.
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const attached = new Map<string, string>();
  if (rows.length) {
    const files = await app.db.query`
      SELECT ef.entry_id, ef.field, f.name
      FROM ${sql.id(tableRef("form4_entry_file"))} ef
      JOIN ${sql.id(tableRef("file"))} f ON f.id = ef.file_id
      WHERE ef.entry_id IN (${sql.join(rows.map((row) => sql`${row.id}`), ", ")}) ORDER BY ef.id`;
    for (const f of files) {
      const key = `${f.entry_id}:${f.field}`;
      attached.set(key, [attached.get(key), f.name].filter(Boolean).join(", "));
    }
  }
  const head = [await app.t`Received`, ...names.map((n) => label[n] || n)].map(cell).join(";");
  const body = rows.map((row) =>
    [date(row.created), ...names.map((n) => attached.get(`${row.id}:${n}`) ?? row.data[n])].map(cell).join(";")
  );
  return [head, ...body].join("\r\n") + "\r\n";
}
