import { html, sql, sqlSearch } from "@qino/qino";
import { cms } from "@qino/qino/cms";

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** One direct link with its target resolved. `kind`: "page" — the target node exists ·
 *  "external" — any other target · "orphan" — a node id that is gone. `shadowed`: a page url
 *  answers that request first, so cms/render.ts never reaches this entry. `root`: the entry
 *  link of the site (the empty request), which must not be deleted. */
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

/** Every direct link, resolved. Needs a request context — page urls are language-specific.
 *  There is no paging: a site has redirects, not a redirect archive, and search narrows. */
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

  /* Which targets still exist, and which requests a page url already answers: one query each for
     the whole table. The id match happens in JS because `page.id = page_redirect.redirect`
     compares an integer column to a text one — only SQLite quietly makes that work. */
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
      title: target ? String(await target.showTitle()).replace(/<[^>]*>/g, "").trim() : "",
      href: target ? await target.url() : kind === "external" ? redirect : "",
      shadowed: shadowed.has(request),
      root: request === "",
    });
  }
  const bad = (row: Row) => row.kind === "orphan" || row.shadowed;
  return { rows: opts.broken ? rows.filter(bad) : rows, broken: rows.filter(bad).length };
}

/** Leading and trailing slashes are noise: cms/render.ts matches `ctx.req.appPath`, which has neither. */
export const cleanRequest = (v: string): string => String(v ?? "").trim().replace(/^\/+/, "").replace(/\/+$/, "");

/** The 404 box refuses these too — a direct link ends up in a Location header. */
export const unsafe = (target: string): boolean => /^(javascript|data|vbscript|file):/i.test(target);

/** Create (no `from`) or change one direct link. Returns the message to show, "" when written. */
export async function write(app: App, vs: { from?: string; request?: string; redirect?: string }): Promise<string> {
  const request = cleanRequest(String(vs.request ?? ""));
  const redirect = String(vs.redirect ?? "").trim();
  if (!redirect) return String(await app.t`A direct link needs a target.`);
  if (unsafe(redirect)) return String(await app.t`Unsupported redirect target.`);
  // A request that a page url or another direct link answers would never reach this one.
  if (request !== vs.from && await used(app, request)) return String(await app.t`URL already in use`);
  const table = app.db.table("page_redirect");
  await (vs.from === undefined ? table.insert({ request, redirect }) : table.update({ request: vs.from }, { request, redirect }));
  return "";
}

async function used(app: App, request: string): Promise<boolean> {
  const rows = await app.db.one`
    SELECT (SELECT count(*) FROM ${sql.id("page_redirect")} WHERE request = ${request})
         + (SELECT count(*) FROM ${sql.id("page_url")} WHERE url = ${request})`;
  return !!Number(rows);
}

/** The table body. Pure: everything it shows comes from `rows`, so a test can hand it any state. */
export function renderRows(rows: Row[], labels: Record<"root" | "orphan" | "shadowed" | "external" | "confirm" | "empty", string>): HtmlString {
  if (!rows.length) return html`<tr><td colspan=4>${labels.empty}`;
  // State is a badge, not a colour on the row — the red badge is the house style for "look here"
  // (cms.backend.superuser.db writes it the same way) and no stylesheet has to ship for it.
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

/** The list part. Its state (search, sort, filter) lives in the browser and comes back as vars,
 *  and so do its writes — the same way cms.backend.superuser.shorturl deletes. */
export async function list(node: Node, { vars = {} }: { vars?: Record<string, unknown> } = {}): Promise<HtmlString> {
  const app = node.app, t = app.t;

  let message = "";
  if (typeof vars.delete === "string") {
    // No button offers this for the entry link, but the var could still ask for it.
    if (vars.delete === "") message = String(await t`The entry link cannot be deleted.`);
    else await app.db.table("page_redirect").deleteWhere({ request: vars.delete });
  } else if (vars.save) message = await write(app, vars.save as Record<string, string>);

  const sort = SORTABLE.includes(String(vars.sort)) ? String(vars.sort) : "";
  const dir = String(vars.dir ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
  const broken = !!vars.broken;
  const { rows, broken: bad } = await collect(app, { search: String(vars.search ?? ""), sort, dir, broken });

  /* Every label is awaited here: only html.async resolves a promise, and these go into nested
     html`` templates, which would render them as "[object Promise]". */
  const [root, orphan, shadowed, external, confirm, empty, attention, all, request, target, resolves] = await Promise.all(
    [t`Start`, t`orphaned`, t`shadowed`, t`external`, t`Really delete this direct link?`, t`No direct links`,
      t`need attention`, t`show all`, t`Request`, t`Target`, t`Resolves to`],
  );
  const th = (col: string, label: string) =>
    html`<th data-sort="${col}" data-dir="${col === sort && dir === "DESC" ? "asc" : "desc"}">${label}${col === sort ? (dir === "ASC" ? " ↑" : " ↓") : ""}`;

  /* The caption carries what the toolbar above the table cannot know before the query ran: the
     answer to the last write, and how many entries the "only broken" filter would show. */
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
