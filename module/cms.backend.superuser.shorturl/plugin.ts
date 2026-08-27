import { html, sql, sqlSearch, unixTime } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { PATH, shorten } from "@qino/qino/shorturl";
import * as u2 from "@qino/qino/u2";

import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "URL shortener", de: "URL-Kürzer" });
}

// ── list (searchable, sortable part) ───────────────────────────────────────
const SORTABLE = ["code", "url", "hits", "last", "expires"];
const PER_PAGE = 50;

async function list(node: Node, { vars = {} }: { vars?: Record<string, unknown> }): Promise<HtmlString> {
  const { t, db } = node.app;
  if (vars.delete) await db.table("shorturl").delete(String(vars.delete));

  const search = String(vars.search ?? "");
  const sort = SORTABLE.includes(String(vars.sort)) ? String(vars.sort) : "";
  const dir = String(vars.dir ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
  const sh = sqlSearch(search, ["url"], { exact: ["code"] });
  // an unsorted search is ordered by how well it matched; a clicked column always wins
  const order = sort ? sql`${sql.id(sort)} ${sql.raw(dir)}` : sql`${sh.order}, hits DESC`;
  // one page at a time: the table grows with every campaign, and sorting it belongs in the database
  const page = Math.max(0, Number(vars.page) || 0);
  const total = Number(await db.one`SELECT count(*) FROM shorturl WHERE ${sh.where}`);
  const rows = await db.query`
    SELECT * FROM shorturl WHERE ${sh.where} ORDER BY ${order}, code LIMIT ${PER_PAGE} OFFSET ${page * PER_PAGE}`;

  const root = await node.app.url();
  const now = unixTime();
  const [tNever, tConfirm, ...labels] = await Promise.all([
    t`never`, t`Really delete this short link?`,
    t`Code`, t`Target`, t`Hits`, t`Last`, t`Expires`,
  ]);
  const from = total ? page * PER_PAGE + 1 : 0;
  const to = page * PER_PAGE + rows.length;
  const trs = rows.map((row) => {
    const link = `${root}${PATH}/${row.code}`;
    const expired = row.expires != null && Number(row.expires) < now;
    return html`<tr${expired ? html.raw(' style="opacity:.5"') : ""}>
      <td><a href="${link}" target=_blank><code>${row.code}</code></a>
      <td class=-url><a href="${row.url}" target=_blank>${row.url}</a>
      <td style="text-align:right">${Number(row.hits)}
      <td>${u2.el.time(row.last, { narrow: true })}
      <td>${row.expires == null ? html`<small>${tNever}</small>` : u2.el.time(row.expires, { narrow: true })}
      <td><button data-delete="${row.code}" class=u2-unstyle u2-confirm="${tConfirm}"><u2-ico icon=delete>✕</u2-ico></button>`;
  });

  // clicking a column sorts by it; clicking the sorted one turns it around
  const th = (col: string, label: string) => html`<th data-sort="${col}" data-dir="${col === sort && dir === "DESC" ? "asc" : "desc"}">${label}${col === sort ? (dir === "ASC" ? " ↑" : " ↓") : ""}`;

  const pager = html`<tfoot><tr><td colspan=6>
    <button data-page="${page - 1}"${page ? "" : html.raw(" disabled")}>‹</button>
    ${from}–${to} / ${total}
    <button data-page="${page + 1}"${to < total ? "" : html.raw(" disabled")}>›</button>`;

  return html.async`
<thead><tr>${SORTABLE.map((col, i) => th(col, labels[i]))}
    <th width=40>
<tbody>${trs.length ? trs : html`<tr><td colspan=6>${await t`No short links`}`}
${total > PER_PAGE ? pager : ""}`;
}

// ── render ──────────────────────────────────────────────────────────────────
async function render(node: Node, { ctx, vars = {} }: { ctx: Ctx; vars?: Record<string, unknown> }): Promise<HtmlString> {
  const { t } = node.app;

  let message: HtmlString | "" = "";
  if (vars.create) {
    const data = vars.create as Record<string, string>;
    const url = String(data.url ?? "").trim();
    const expires = data.expires ? backend.toUnix(data.expires) : undefined;
    if (url) {
      // the target is written by a superuser, so anything the runtime accepts as a URL is theirs to make
      message = await shorten(node.app, url, { expires })
        .then((link) => html`<a href="${link}" target=_blank>${link}</a>`)
        .catch((e) => html`<span style="color:var(--red)">${e.message ?? e}</span>`);
    }
  }

  const search = String(ctx.req.query.search ?? "");

  return html.async`<div class=u2-flex>
    <style>
        [cms-part=list] .-url a { display:block; max-width:40rem; white-space:nowrap; text-overflow:ellipsis; overflow:hidden }
        [cms-part=list] th[data-sort] { cursor:pointer; user-select:none }
    </style>

    <div class=u2-card style="flex:1 1 100%">
        <div class=-head>${t`New short link`}</div>
        <div class=-body>
            <form data-create class=u2-flex style="gap:.5em 1em; align-items:end">
                <label style="flex:1 1 25rem">${t`Target URL`}<br><input type=url name=url required placeholder="https://…" style="width:100%"></label>
                <label>${t`Expires`}<br><input type=date name=expires></label>
                <button>${t`Shorten`}</button>
            </form>
            ${message ? html`<p>${message}</p>` : ""}
        </div>
    </div>

    <div class=u2-card style="flex:1 1 60rem; max-height:88vh; overflow:auto">
        <div class=-head>${t`Short links`}</div>
        <div class=-body style="flex-grow:0">
            <input type=search data-search value="${search}" placeholder="${t`Code or URL`}">
        </div>
        <table class=u2-table cms-part=list>${await list(node, { vars: { search } })}</table>
    </div>
</div>`;
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const row = await app.db.row`SELECT count(*) AS links, sum(hits) AS hits FROM shorturl WHERE expires IS NULL OR expires >= ${unixTime()}`;
  return html.async`<div class=-body>
    <b>${Number(row?.links ?? 0)}</b> ${app.t`short links`}<br>
    <small>${Number(row?.hits ?? 0)} ${app.t`hits`}</small>
</div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    parts: { list },
  },
};
