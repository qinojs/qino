import { html, sql, sqlSearch } from "@qino/qino";
import { cleanRequest, cms, requestUsed } from "@qino/qino/cms";

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** A direct link with resolved target. `kind`: "page" (node exists) · "external" · "orphan" (node
 *  gone). `shadowed`: a page url matches first, so this entry is never used. `root`: the site's entry
 *  link (empty request), not deletable. */
export type Row = {
  request: string;
  redirect: string;
  kind: "page" | "external" | "orphan";
  title: string;
  href: string;
  shadowed: boolean;
  root: boolean;
};

export const SORTABLE = ["request", "redirect"];

const isNodeId = (v: string) => /^\d+$/.test(v);
const inList = (vs: (string | number)[]) => sql.join(vs.map((v) => sql`${v}`), ", ");

/** All direct links, resolved. Needs a request (page urls depend on the language). No paging;
 *  use search. */
export async function collect(app: App, opts: {
  search?: string;
  sort?: string;
  dir?: "ASC" | "DESC";
  broken?: boolean;
} = {}): Promise<{ rows: Row[]; broken: number }> {
  const db = app.db;
  const sh = sqlSearch(String(opts.search ?? ""), ["request", "redirect"]);
  const sort = SORTABLE.includes(String(opts.sort)) ? String(opts.sort) : "";
  // an unsorted search is ordered by how well it matched; a clicked column always wins
  const order = sort ? sql`${sql.id(sort)} ${sql.raw(opts.dir === "ASC" ? "ASC" : "DESC")}` : sql`${sh.order}, request`;
  const all = await db.query`SELECT request, redirect FROM ${sql.id("page_redirect")} WHERE ${sh.where} ORDER BY ${order}`;

  /* Existing targets and requests answered by page urls: one query each. Ids are matched in JS,
     since `page.id = page_redirect.redirect` compares integer with text (only SQLite allows that). */
  const ids = [...new Set(all.map((r) => String(r.redirect)).filter(isNodeId))];
  const requests = [...new Set(all.map((r) => String(r.request)))];
  const alive = new Set(!ids.length ? [] : (await db.query`
    SELECT id FROM ${sql.id("page")} WHERE id IN (${inList(ids.map(Number))})`).map((r) => String(r.id)));
  const shadowed = new Set(!requests.length ? [] : (await db.query`
    SELECT url FROM ${sql.id("page_url")} WHERE url IN (${inList(requests)})`).map((r) => String(r.url)));

  const rows: Row[] = [];
  for (const r of all) {
    const request = String(r.request ?? ""), redirect = String(r.redirect ?? "");
    const kind = !isNodeId(redirect) ? "external" : alive.has(redirect) ? "page" : "orphan";
    const target = kind === "page" ? await cms(app).node(Number(redirect)) : undefined;
    rows.push({
      request,
      redirect,
      kind,
      title: target ? (await target.showTitle()).plain() : "",
      href: target ? await target.url() : kind === "external" ? redirect : "",
      shadowed: shadowed.has(request),
      root: request === "",
    });
  }
  const bad = (row: Row) => row.kind === "orphan" || row.shadowed;
  return { rows: opts.broken ? rows.filter(bad) : rows, broken: rows.filter(bad).length };
}

/** The 404 box refuses these too — a direct link ends up in a Location header. */
export const unsafe = (target: string): boolean => /^(javascript|data|vbscript|file):/i.test(target);

/** Create (no `from`) or change one direct link. Returns the message to show, "" when written. */
export async function write(app: App, vs: { from?: string; request?: string; redirect?: string }): Promise<string> {
  const request = cleanRequest(String(vs.request ?? ""));
  const redirect = String(vs.redirect ?? "").trim();
  if (!redirect) return app.t`A direct link needs a target.`;
  if (unsafe(redirect)) return app.t`Unsupported redirect target.`;
  // A request that a page url or another direct link answers would never reach this one.
  if (request !== vs.from && await requestUsed(request)) return app.t`URL already in use`;
  const table = app.db.table("page_redirect");
  await (vs.from === undefined ? table.insert({ request, redirect }) : table.update({ request: vs.from }, { request, redirect }));
  return "";
}

/** The table body. Pure: everything it shows comes from `rows`, so a test can hand it any state. */
export function renderRows(rows: Row[], labels: Record<"root" | "orphan" | "shadowed" | "external" | "confirm" | "empty", string>): HtmlString {
  if (!rows.length) return html`<tr><td colspan=4>${labels.empty}`;
  // State as a badge (like cms.backend.superuser.db), no own stylesheet needed.
  const badge = (label: string, red?: boolean) =>
    html`<span class=u2-badge${red ? html.raw(' style="background:var(--red)"') : ""}>${label}</span> `;
  return html`${rows.map((row) => html`<tr data-from="${row.request}">
      <td><input data-request value="${row.root ? "/" : row.request}" size=16${row.root ? html.raw(" readonly") : ""}>
      <td><input type=qgcms-page data-target value="${row.redirect}" size=24>
      <td>${row.root ? badge(labels.root) : ""}${row.kind === "orphan" ? badge(labels.orphan, true) : ""}${
    row.shadowed ? badge(labels.shadowed, true) : ""}${row.kind === "external" ? badge(labels.external) : ""}${
    row.href ? html`<a href="${row.href}" target=_blank>${row.title || row.href}</a>` : ""}
      <td>${row.root ? "" : html`<button data-delete="${row.request}" class=u2-unstyle u2-confirm="${labels.confirm}"><u2-ico icon=delete>✕</u2-ico></button>`}`)}`;
}

/** The list part. Search, sort, filter and writes come from the browser as vars (like
 *  cms.backend.superuser.shorturl). */
export async function list(node: Node, { vars = {} }: { vars?: Record<string, unknown> } = {}): Promise<HtmlString> {
  const app = node.app, t = app.t;

  let message = "";
  if (typeof vars.delete === "string") {
    // No button offers this for the entry link, but the var could still ask for it.
    if (vars.delete === "") message = await t`The entry link cannot be deleted.`;
    else await app.db.table("page_redirect").deleteWhere({ request: vars.delete });
  } else if (vars.save) message = await write(app, vars.save as Record<string, string>);

  const sort = SORTABLE.includes(String(vars.sort)) ? String(vars.sort) : "";
  const dir = String(vars.dir ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
  const broken = !!vars.broken;
  const { rows, broken: bad } = await collect(app, { search: String(vars.search ?? ""), sort, dir, broken });

  /* Labels are awaited here: nested html`` templates would render promises as "[object Promise]". */
  const [root, orphan, shadowed, external, confirm, empty, attention, all, request, target, resolves] = await Promise.all(
    [t`Start`, t`orphaned`, t`shadowed`, t`external`, t`Really delete this direct link?`, t`No direct links`,
      t`need attention`, t`show all`, t`Request`, t`Target`, t`Resolves to`],
  );
  const th = (col: string, label: string) =>
    html`<th data-sort="${col}" data-dir="${col === sort && dir === "DESC" ? "asc" : "desc"}">${label}${col === sort ? (dir === "ASC" ? " ↑" : " ↓") : ""}`;

  /* The caption shows the result of the last write and the "only broken" count. */
  return html.async`${
    message
      ? html`<caption><u2-alert open variant=warning>${message}</u2-alert>`
      : bad
      ? html`<caption><button data-broken="${broken ? "" : "1"}">${bad} ${attention}${broken ? ` — ${all}` : ""}</button>`
      : ""
  }
<thead><tr>${th("request", request)}${th("redirect", target)}<th>${resolves}<th width=40>
<tbody>${renderRows(rows, { root, orphan, shadowed, external, confirm, empty })}`;
}
