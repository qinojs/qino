import { html, getCtx, sql, sqlSearch } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import * as u2 from "@qino/qino/u2";
import { cms as cmsOf } from "@qino/qino/cms";
import { editorUrl } from "@qino/qino/fileEditor";

import type { Sql, Ctx, App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.superuser.error_report", { en: "Errors", de: "Fehler" });
}

function makeFileHelper(ctx: Ctx) {
  /** Local fs path for a report/backtrace file; `file:` URLs only within the app root policy. */
  function localPath(file: string): string | null {
    if (!file.startsWith("file:")) return ctx.urlToLocalPath(file);
    try {
      const path = new URL(file).pathname;
      ctx.app.assertAllowedPath(path);
      return path;
    } catch { return null; }
  }
  /** undefined for files that are not local app files — no link, no editor grant. */
  function editorLink(file: string, line: unknown, col: unknown): string | undefined {
    const path = localPath(file);
    return path ? editorUrl(path, { line, col }) : undefined;
  }
  function fileDisplay(file: string): string {
    const path = localPath(file);
    if (!path) return file;
    for (const mod of ctx.app.modules.all().values()) {
      if (mod.dir && path.startsWith(mod.dir)) return "m/" + mod.name + "/" + path.slice(mod.dir.length);
    }
    const mIdx = path.lastIndexOf("/m/");
    return mIdx >= 0 ? path.slice(mIdx + 1) : path;
  }
  return { editorLink, fileDisplay };
}

async function render(node: Node, { vars = {} }: { vars?: Record<string, any> } = {}): Promise<HtmlString> {
  const { t, db } = node.app;
  const ctx = getCtx();
  const get = ctx.req.query;

  if (vars.delete) {
    const where = db.table("m_error_report").valuesToFragment(vars.delete);
    if (where.parts.length) await db.exec`DELETE FROM m_error_report WHERE ${where}`;
  }
  if (vars.deleteGroup) {
    await db.exec`DELETE FROM m_error_report WHERE ${groupWhere(db, vars.deleteGroup)}`;
  }
  if (vars.deleteMatching) {
    await db.exec`DELETE FROM m_error_report WHERE ${filterWhere(db, vars.deleteMatching)}`;
  }

  if (get.id) return renderDetail(node, Number(get.id));
  if (get.show === "entries") return renderEntryList(node, ctx, get);

  const sources = await db.col<string>`SELECT DISTINCT source FROM m_error_report ORDER BY source`;
  const prios   = await db.col<string>`SELECT DISTINCT prio FROM m_error_report ORDER BY prio`;
  const opts    = (vals: string[], cur: string) => vals.map(v => html`<option ${v === cur ? "selected" : ""}>${v}</option>`);
  const ranges: [string, string][] = [["", await t`all time`], ["1", await t`last 24h`], ["7", await t`last 7 days`], ["30", await t`last 30 days`]];
  const range  = get.range ?? "30"; // default window keeps the group scan off the full table

  const filterForm = html.async`
  <form>
    <input type=search name=search value="${get.search}" placeholder="${t`message, /path, IP or id`}"
      title="${t`Words search the message, a path (with /) the file, an IP address or a numeric id match exactly`}">
    <select name=source>
      <option value="">${t`All sources`}</option>${opts(sources, get.source ?? "")}
    </select>
    <select name=prio>
      <option value="">${t`All priorities`}</option>${opts(prios, get.prio ?? "")}
    </select>
    <select name=range>
      ${ranges.map(([v, l]) => html`<option value="${v}" ${v === range ? "selected" : ""}>${l}</option>`)}
    </select>
    <select name=order>
      <option value=max_id>${t`sort by date`}</option>
      <option value=num_ip ${get.order === "num_ip" ? "selected" : ""}>${t`sort by number of IPs`}</option>
    </select>
  </form>`;

  return html.async`
<div class=u2-card>
  <div class=-head>${t`Errors`}</div>
  <div class=-body>
    ${filterForm}
    <div>
      <button data-delete-matching u2-confirm="${t`Really delete all matching entries?`}">${t`Delete matching`}</button>
    </div>
  </div>
  <div cms-part=list style="overflow:auto; max-height:80vh; padding:0; border-top:.4rem solid var(--color-darker)">${list(node, { ctx, vars: { ...get, range } })}</div>
</div>`;
}

// WHERE for one error group (source/file/line/col). A missing value travels through URLs and
// datasets as "null" or "" — the field decides what that means, "" being NULL on a numeric column.
function groupWhere(db: App["db"], vals: Record<string, unknown>): Sql {
  const cols = ["source", "file", "line", "col"];
  return db.table("m_error_report").valuesToFragment(
    Object.fromEntries(cols.map(c => [c, vals[c] === "null" ? null : vals[c] ?? null])),
  );
}

// Cutoff in the table's "YYYY-MM-DD HH:MM:SS" time format; compares via the time index.
const daysAgo = (days: number) => new Date(Date.now() - days * 86400e3).toISOString().slice(0, 19).replace("T", " ");

// WHERE for the current search/filter state — shared by the list part and "delete matching".
// The search dispatches on input shape to indexed paths: id/log_id, ip, or fulltext
// MATCH on message/file (mysql). sqlite/pg get no fulltext index (schema engine
// skips it) — the LIKE fallback there scans no more than the grouped view already does.
function filterWhere(db: App["db"], vars: Record<string, unknown>): Sql {
  const search  = String(vars.search ?? "").trim();
  const fSource = String(vars.source ?? "");
  const fPrio   = String(vars.prio ?? "");
  const fRange  = Number(vars.range) || 0; // days; bounds the group scan via the time index
  const conds = [];
  if (fSource) conds.push(sql`source = ${fSource}`);
  if (fPrio)   conds.push(sql`prio = ${fPrio}`);
  if (fRange)  conds.push(sql`time >= ${daysAgo(fRange)}`);
  if (search) {
    const ftCol = search.includes("/") ? "file" : "message";
    const words = search.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 3).slice(0, 4);
    if (/^\d+$/.test(search)) conds.push(sql`(id = ${Number(search)} OR log_id = ${Number(search)})`);
    else if (/[.:]/.test(search) && /^[0-9a-f.:]+$/i.test(search)) conds.push(sql`ip = ${search}`);
    // words below ft_min_token_size can never hit the fulltext index — empty result beats a full scan
    else if (db.dialect === "mysql") conds.push(words.length ? sql`MATCH(${sql.id(ftCol)}) AGAINST (${words.map(w => `+${w}*`).join(" ")} IN BOOLEAN MODE)` : sql`${false}`);
    else conds.push(sqlSearch(search, [ftCol]).where);
  }
  return conds.length ? sql.join(conds, " AND ") : sql`${true}`;
}

// List part — re-rendered live on filter input via cms.reloadPart(nid, "list", form values).
async function list(node: Node, { ctx, vars = {} }: { ctx: Ctx; vars?: Record<string, unknown> }): Promise<HtmlString> {
  const { t, db } = node.app;
  const orderSql = vars.order !== "num_ip" ? "g.max_id DESC" : "g.num_ip DESC, g.num DESC";
  const where = filterWhere(db, vars);

  const rows = await db.query`
    SELECT e.*,
      g.num,
      g.num_ip,
      g.time,
      g.num_bot,
      g.num_unsupported,
      usr.email AS usr_email
    FROM (
      SELECT source, file, line, col,
        max(id)                    AS max_id,
        count(*)                   AS num,
        count(DISTINCT ip)         AS num_ip,
        max(time)                  AS time,
        sum(CASE WHEN bot THEN 1 ELSE 0 END)            AS num_bot,
        sum(CASE WHEN unsupported_ua THEN 1 ELSE 0 END) AS num_unsupported
      FROM m_error_report
      WHERE ${where}
      GROUP BY source, file, line, col
    ) g
      JOIN m_error_report e ON e.id = g.max_id
      LEFT JOIN log  ON e.log_id   = log.id
      LEFT JOIN sess ON log.sess_id = sess.id
      LEFT JOIN usr  ON sess.usr_id = usr.id
    ORDER BY ${sql.raw(orderSql)}`;

  const filtered = [vars.search, vars.source, vars.prio, vars.range].some(v => String(v ?? "").trim());
  if (!rows.length) return html`<div class=-body>${filtered ? await t`No matching entries` : await t`Great, no errors so far!`}</div>`;

  const { editorLink } = makeFileHelper(ctx);
  const u = ctx.req.url.toURL();
  const trs = [];
  for (const row of rows) {
    const color   = ({ error: "var(--red)", warning: "var(--orange)", notice: "var(--blue)" })[String(row.prio)] ?? "var(--gray)";
    const num     = Number(row.num)     || 0;
    const numBot  = Number(row.num_bot) || 0;
    const numUns  = Number(row.num_unsupported) || 0;
    const msg     = String(row.message ?? "");
    u.searchParams.set("show", "entries");
    u.searchParams.set("source", String(row.source));
    u.searchParams.set("file", String(row.file));
    u.searchParams.set("line", String(row.line));
    u.searchParams.set("col", String(row.col));
    const entriesUrl = u.search;
    const eUrl     = editorLink(row.file, row.line, row.col);
    const msgShort = msg.slice(0, 300) + (msg.length > 300 ? "…" : "");
    const msgCell  = eUrl ? html`<a target=_blank href="${eUrl}">${msgShort}</a>` : msgShort;
    trs.push(html`
<tr u2-href>
  <td style="width:3rem; white-space:nowrap">
    <small class=u2-badge style="background-color:${color}">${row.prio || "?"}</small> <small>${num}x</small>
  <td style="width:6rem">
    <a href="${entriesUrl}">${row.num_ip} IPs</a>
  <td style="width:6rem">
    ${row.source}
  <td style="width:6rem; white-space:nowrap">
    <small>
      <div style="display:inline-block; border:1px solid; width:1.875rem; vertical-align:middle">
        <div style="height:.6em; width:${num ? Math.round(numBot * 100 / num) : 0}%; background:currentColor"></div>
      </div> bots: ${numBot}
    </small><br>
    <small>
      <div style="display:inline-block; border:1px solid; width:1.875rem; vertical-align:middle">
        <div style="height:.6em; width:${num ? Math.round(numUns * 100 / num) : 0}%; background:currentColor"></div>
      </div> oldies: ${numUns}
    </small>
  <td>
    ${msgCell}<br>
    <small>${u2.el.time(row.time)}</small>
    <div>${row.usr_email}</div>
  <td>
    <button class=u2-unstyle type=button
      data-delete-group
      data-source="${row.source}"
      data-file="${row.file}"
      data-line="${row.line}"
      data-col="${row.col}"
      aria-label=Delete><u2-ico icon=delete aria-hidden=true>✕</u2-ico></button>`);
  }

  return html`
<table class=u2-table>
  <tbody style="vertical-align:baseline">
    ${trs}
</table>`;
}

async function renderEntryList(node: Node, ctx: Ctx, get: Record<string, string>): Promise<HtmlString> {
  const db = node.app.db;
  const { editorLink, fileDisplay } = makeFileHelper(ctx);

  if (!["source", "file", "line", "col"].some(k => get[k] !== undefined)) return html`<div>${await node.app.t`Invalid parameters`}</div>`;
  const where = groupWhere(node.app.db, get);

  const rows = await db.query`
    SELECT e.*, usr.email
    FROM m_error_report e
      LEFT JOIN log  ON e.log_id   = log.id
      LEFT JOIN sess ON log.sess_id = sess.id
      LEFT JOIN usr  ON sess.usr_id = usr.id
    WHERE ${where} ORDER BY e.time DESC LIMIT 200`;

  const trs = [];
  const u = ctx.req.url.toURL();
  const back = ctx.req.url.toURL();
  for (const k of ["show", "source", "file", "line", "col"]) back.searchParams.delete(k);
  for (const row of rows) {
    const eUrl = editorLink(row.file ?? "", row.line, row.col);
    const sample = row.sample ? html`<pre style="font-size:10px; box-shadow:0 0 .3125rem; padding:.25rem">${row.sample}</pre>` : "";
    const fileCell = eUrl
      ? html`<a href="${eUrl}" target=_blank title="${row.file}" style="color:inherit; text-decoration:none">${sample || "edit File"}</a>`
      : sample;

    const btTrs = [];
    const bt = row.backtrace ? JSON.parse(row.backtrace) : [];
    for (const item of bt) {
      const itemUrl = editorLink(item.file ?? "", item.line, item.col);
      const name = fileDisplay(item.file ?? "");
      btTrs.push(html`<tr>
  <td style="padding-right:1rem">${itemUrl ? html`<a href="${itemUrl}" target=_blank>${name}</a>` : name}
  <td style="padding-right:1rem">${item.function}
  <td>${item.args ? JSON.stringify(item.args) : ""}`);
    }

    u.searchParams.set("id", String(row.id));
    trs.push(html`
<tr style="white-space:nowrap">
  <td>
    <a href="${u.search}">${u2.el.time(row.time)} <br> ${row.log_id}</a>
    <br><button data-delete="${row.id}">delete</button>
  <td>
    <b>${row.message}</b><br>
    <a href="${row.request}" target=_blank>${row.request}</a><br>
    <a href="${row.referer}" target=_blank>${row.referer}</a><br>
    <small>${row.browser}</small>
    <br>${row.ip}
    <br>${row.email}
  <td>${fileCell}
  <td>${bt.length ? html`<table>${btTrs}</table>` : ""}`);
  }

  return html.async`
<div class=u2-card style="height:88vh; overflow:auto; flex:1 1 80rem">
  <div class=-head><a href="${back.search || "?"}">← ${node.app.t`Errors`}</a> &nbsp; ${get.file} : ${get.line} : ${get.col}</div>
  <table class=u2-table>
    <tbody style="vertical-align:baseline">
      ${trs}
  </table>
</div>`;
}

async function renderDetail(node: Node, id: number): Promise<HtmlString> {
  const { t, db } = node.app;
  const ctx = getCtx();
  const get = ctx.req.query;
  const { editorLink, fileDisplay } = makeFileHelper(ctx);

  const error = await db.row`SELECT * FROM m_error_report WHERE id = ${id}`;
  if (!error) return html`<div>${await t`Error entry not found`}</div>`;

  const log  = error.log_id ? await db.row`SELECT * FROM log WHERE id = ${error.log_id}` : null;
  const sess = log?.sess_id  ? await db.row`SELECT * FROM sess WHERE id = ${log.sess_id}` : null;
  const usr  = sess?.usr_id  ? await db.row`SELECT * FROM usr  WHERE id = ${sess.usr_id}` : null;

  const btTrs = [];
  const bt = error.backtrace ? JSON.parse(error.backtrace) : [];
  for (const item of bt) {
    const itemUrl = editorLink(item.file ?? "", item.line, item.col);
    const position = html`<span style="opacity:.6">: ${item.line}${item.col ? " : " + item.col : ""}</span>`;
    const fileCell = itemUrl
      ? html`<a href="${itemUrl}" target=_blank>${fileDisplay(item.file ?? "")} ${position}</a>`
      : html`${item.file} ${position}`;
    btTrs.push(html`
<tr>
  <td>${fileCell}
  <td>${item.function}
  <td>${item.args ? JSON.stringify(item.args) : ""}`);
  }

  const historyOf = get.history_of ?? "ip";
  let historyWhere: Sql | null = null;
  if      (historyOf === "ip"     && error.ip)       historyWhere = sql`log.ip_id IN (SELECT id FROM log_ip WHERE ip = ${error.ip})`;
  else if (historyOf === "sess"   && log?.sess_id)   historyWhere = sql`log.sess_id = ${log.sess_id}`;
  else if (historyOf === "client" && log?.client_id) historyWhere = sql`log.client_id = ${log.client_id}`;

  const historyTrs = [];
  if (historyWhere) {
    const logs = await db.query`
      SELECT log.*, url.url, referer.url AS referer
      FROM log
        LEFT JOIN log_url url     ON log.url_id     = url.id
        LEFT JOIN log_url referer ON log.referer_id = referer.id
      WHERE ${historyWhere} AND log.id <= ${error.log_id}
      ORDER BY log.id DESC LIMIT 30`.catch(() => []);

    const eu = ctx.req.url.toURL(); eu.searchParams.delete("history_of");
    for (const item of logs) {
      const errorItems = await db.query`SELECT * FROM m_error_report WHERE log_id = ${item.id} ORDER BY id DESC`.catch(() => []);
      const errorLinks = [];
      for (const eItem of errorItems) {
        const active = eItem.id === error.id ? html.raw("&#x25B6;&#xFE0E;") : "";
        eu.searchParams.set("id", String(eItem.id));
        errorLinks.push(html`<a style="color:var(--red); border:1px solid; border-width:1px 0; padding:.1875rem 0; margin-bottom:-1px; display:block" href="${eu.search}">${active} ${eItem.message}</a>`);
      }
      historyTrs.push(html`
<tr>
  <td>${u2.el.time(item.time)} <br> Session: ${item.sess_id} <br> Log-ID: ${item.id}
  <td>
    <a href="${item.url}" target=_blank>${item.url}</a><br>
    <div style="font-size:.9em; color:#aaa">${item.referer}</div>
    ${errorLinks}
  <td><div style="max-width:37.5rem; overflow:auto">${item.post}</div>`);
    }
  }

  const hu = ctx.req.url.toURL(); hu.searchParams.set("id", String(id));
  const histHref = (h: string) => { hu.searchParams.set("history_of", h); return hu.search; };
  const historyLinks = html`
<a href="${histHref("ip")}">IP</a>
${log ? html`<a href="${histHref("sess")}">Session</a> | <a href="${histHref("client")}">Client</a>` : ""}`;

  const fileUrl = editorLink(error.file ?? "", error.line, error.col);
  const sample = error.sample ? html`<pre style="box-shadow:0 0 .625rem; padding:.625rem">${error.sample}</pre>` : "";
  const fileBlock = fileUrl
    ? html`<a style="color:inherit; text-decoration:none" target=_blank href="${fileUrl}">
      <b>${fileDisplay(error.file ?? "")}</b> line: ${error.line} column: ${error.col}
      ${sample}
    </a>`
    : html`<b>${error.file}</b> line: ${error.line} column: ${error.col}
    ${sample}`;

  return html.async`
<div class=u2-flex style="font-size:.95em">
  <div class=u2-card style="overflow:auto; width:auto; flex:1 1 20rem">
    <div class=-head>${t`Error`}</div>
    <div class=-body>
      <p>
        <span style="color:var(--red)">${error.source} ${error.prio}:</span>
        ${error.message}
      </p>
      ${fileBlock}
    </div>
    <table class=u2-table>
      <tr><th>${t`Id`}<td>${error.id}
      <tr><th>${t`Request`}<td>
        <a href="${error.request}">${error.request}</a><br>
        <small>${t`Referer`} <a href="${error.referer}">${error.referer}</a></small>
      <tr><th>${t`Browser`}<td><small>${error.browser}</small>
      <tr><th>${t`Time`}<td>${u2.el.time(error.time)} <small>(Log-ID ${error.log_id ?? ""})</small>
      <tr><th>${t`IP`}<td>${error.ip}
    </table>
    <div class=-body>
      ${sess ? html`<b>Sess</b><pre>${JSON.stringify(sess, null, 2)}</pre>` : ""}
      <button data-delete="${error.id}">delete</button>
    </div>
  </div>

  <div class=u2-card style="overflow:auto;">
    <div class=-head>${t`Backtrace`}</div>
    <table class=u2-table>
      <thead><tr>
        <th>${t`File`}
        <th>${t`Function`}
        <th>${t`Arguments`}
      <tbody>${btTrs}
    </table>
  </div>

  <div class=u2-card style="overflow:auto;">
    <div class=-head>${t`User`}</div>
    <div class=-body>
      ${usr ? html`<pre>${JSON.stringify(usr, null, 2)}</pre>` : html`(${await t`no user`})`}
    </div>
  </div>

  <div class=u2-card style="overflow:auto;">
    <div class=-head>${t`History`}</div>
    <div class=-body style="flex-grow:0">${t`History of:`} ${historyLinks}</div>
    <table class=u2-table>
      <thead><tr>
        <th>${t`Time / Session`}
        <th>${t`URL / Referer`}
        <th>${t`POST`}
      <tbody>${historyTrs}
    </table>
  </div>
</div>`;
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const db = app.db;
  const rows = await db.query`
    SELECT e.prio, e.source, e.file, e.line, e.col, e.message, g.num
    FROM (
      SELECT prio, source, file, line, col, max(id) AS max_id, count(*) AS num
      FROM m_error_report
      WHERE time >= ${daysAgo(7)}
      GROUP BY prio, source, file, line, col
    ) g
    JOIN m_error_report e ON e.id = g.max_id
    ORDER BY CASE e.prio WHEN 'error' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, g.max_id DESC
    LIMIT 5`.catch(() => []);

  if (!rows.length) return html`<span style="color:var(--green)">&#10003; No entries (last 7 days)</span>`;

  const errNode = await cmsOf(app).nodeByModule("cms.backend.superuser.error_report");
  const baseUrl = errNode ? await errNode.url() : null;

  const color: Record<string, string> = { error: "var(--red)", warning: "var(--orange)", notice: "var(--gray)" };
  const trs = [];
  for (const row of rows) {
    const c = color[row.prio] ?? "#333";
    const qs = "?show=entries&source=" + encodeURIComponent(row.source) + "&file=" + encodeURIComponent(row.file) + "&line=" + encodeURIComponent(row.line) + "&col=" + encodeURIComponent(row.col);
    const detailUrl = baseUrl ? baseUrl.replace(/(#|$)/, qs + "$1") : null;
    const msg = html`<span style="max-width:12.5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block">${row.message}</span>`;
    trs.push(html`<tr>
    <td><span style="color:${c};font-weight:bold">${row.prio}</span>
    <td>${row.source}
    <td>${detailUrl ? html`<a href="${detailUrl}">${msg}</a>` : msg}
    <td style="color:#888">${row.num}x`);
  }

  return html`<div style="overflow:auto; padding:0">
<table class=u2-table style="width:100%">
  <thead><tr>
    <th>Prio
    <th>Source
    <th>Message
    <th>Count
  <tbody>${trs}
</table></div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    parts: { list },
  },
};
