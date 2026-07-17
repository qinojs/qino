import { hee, getCtx, sql, sqlSearch, u2time, type Sql, type Ctx, type App } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import { cms as cmsOf, type Node } from "../cms/mod.ts";

export const name = "cms.backend.superuser.error_report";
export const needs = ["cms.backend", "error_report"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.superuser.error_report", { en: "Errors", de: "Fehler" });
}

function makeFileHelper(ctx: Ctx) {
  const appURL = ctx.req.basePath;
  function editorLink(file: string, line: unknown, col: unknown): string {
    const localPath = ctx.urlToLocalPath(file) ?? file;
    return appURL + "editor/?file=" + encodeURIComponent(localPath)
      + "&line=" + encodeURIComponent(String(line ?? ""))
      + "&col="  + encodeURIComponent(String(col  ?? ""));
  }
  function fileDisplay(file: string): string {
    const localPath = ctx.urlToLocalPath(file);
    if (!localPath) return file;
    for (const mod of Object.values(ctx.app.modules.all())) {
      if (mod.dir && localPath.startsWith(mod.dir)) return "m/" + mod.name + "/" + localPath.slice(mod.dir.length);
    }
    const mIdx = localPath.lastIndexOf("/m/");
    return mIdx >= 0 ? localPath.slice(mIdx + 1) : localPath;
  }
  return { editorLink, fileDisplay };
}

async function render(node: Node, { vars = {} }: { vars?: Record<string, any> } = {}): Promise<string> {
  const { t, db } = node.app;
  const ctx = getCtx();
  const get = ctx.req.query;

  if (vars.delete) {
    const where = db.table("m_error_report").valuesToFragment(vars.delete);
    if (where.parts.length) await db.exec`DELETE FROM m_error_report WHERE ${where}`;
  }
  if (vars.deleteGroup) {
    await db.exec`DELETE FROM m_error_report WHERE ${groupWhere(vars.deleteGroup)}`;
  }
  if (vars.deleteMatching) {
    await db.exec`DELETE FROM m_error_report WHERE ${filterWhere(db, vars.deleteMatching)}`;
  }

  if (get.id) return renderDetail(node, Number(get.id));
  if (get.show === "entries") return renderEntryList(node, ctx, get);

  const sources = await db.col<string>`SELECT DISTINCT source FROM m_error_report ORDER BY source`;
  const prios   = await db.col<string>`SELECT DISTINCT prio FROM m_error_report ORDER BY prio`;
  const opts    = (vals: string[], cur: string) => vals.map(v => `<option ${v === cur ? "selected" : ""}>${hee(v)}</option>`).join("");
  const ranges: [string, string][] = [["", await t`all time`], ["1", await t`last 24h`], ["7", await t`last 7 days`], ["30", await t`last 30 days`]];
  const range  = get.range ?? "30"; // default window keeps the group scan off the full table

  const filterForm = `
  <form>
    <input type=search name=search value="${hee(get.search ?? "")}" placeholder="${await t`message, /path, IP or id`}"
      title="${await t`Words search the message, a path (with /) the file, an IP address or a numeric id match exactly`}">
    <select name=source>
      <option value="">${await t`All sources`}</option>${opts(sources, get.source ?? "")}
    </select>
    <select name=prio>
      <option value="">${await t`All priorities`}</option>${opts(prios, get.prio ?? "")}
    </select>
    <select name=range>
      ${ranges.map(([v, l]) => `<option value="${v}" ${v === range ? "selected" : ""}>${hee(l)}</option>`).join("")}
    </select>
    <select name=order>
      <option value=max_id>${await t`sort by date`}</option>
      <option value=num_ip ${get.order === "num_ip" ? "selected" : ""}>${await t`sort by number of IPs`}</option>
    </select>
  </form>`;

  const tools = `
  <div class="-body">
    ${filterForm}
    <div>
      <button data-delete-matching u2-confirm="${await t`Really delete all matching entries?`}">${await t`Delete matching`}</button>
    </div>
  </div>`;

  return `
<div class=u2-card>
  <div class=-head>${await t`Errors`}</div>
  ${tools}
  <div cms-part=list style="overflow:auto; max-height:80vh; padding:0; border-top:.4rem solid var(--color-darker)">${await list(node, { ctx, vars: { ...get, range } })}</div>
</div>`;
}

// WHERE for one error group (source/file/line/col). NULL columns travel through
// URLs and datasets as the string "null" — translate that back to IS NULL.
function groupWhere(vals: Record<string, unknown>): Sql {
  return sql.join(["source", "file", "line", "col"].map(c => {
    const v = vals[c];
    return v == null || v === "null" ? sql`${sql.id(c)} IS NULL` : sql`${sql.id(c)} = ${String(v)}`;
  }), " AND ");
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
  const conds: Sql[] = [];
  if (fSource) conds.push(sql`source = ${fSource}`);
  if (fPrio)   conds.push(sql`prio = ${fPrio}`);
  if (fRange)  conds.push(sql`time >= ${daysAgo(fRange)}`);
  if (search) {
    const ftCol = search.includes("/") ? "file" : "message";
    const words = search.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 3).slice(0, 4);
    if (/^\d+$/.test(search)) conds.push(sql`(id = ${Number(search)} OR log_id = ${Number(search)})`);
    else if (/[.:]/.test(search) && /^[0-9a-f.:]+$/i.test(search)) conds.push(sql`ip = ${search}`);
    // words below ft_min_token_size can never hit the fulltext index — empty result beats a full scan
    else if (db.dialect === "mysql") conds.push(words.length ? sql`MATCH(${sql.id(ftCol)}) AGAINST (${words.map(w => `+${w}*`).join(" ")} IN BOOLEAN MODE)` : sql.raw("false"));
    else conds.push(sqlSearch(search, [ftCol]).where);
  }
  return conds.length ? sql.join(conds, " AND ") : sql.raw("true");
}

// List part — re-rendered live on filter input via cms.reloadPart(nid, "list", form values).
async function list(node: Node, { ctx, vars = {} }: { ctx: Ctx; vars?: Record<string, unknown> }): Promise<string> {
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
  if (!rows.length) return `<div class="-body">${filtered ? await t`No matching entries` : await t`Great, no errors so far!`}</div>`;

  const { editorLink } = makeFileHelper(ctx);
  let tableRows = "";
  for (const row of rows) {
    const color   = ({ error: "var(--red)", warning: "var(--orange)", notice: "var(--blue)" } as Record<string, string>)[String(row.prio)] ?? "var(--gray)";
    const num     = Number(row.num)     || 0;
    const numBot  = Number(row.num_bot) || 0;
    const numUns  = Number(row.num_unsupported) || 0;
    const msg     = String(row.message ?? "");
    const entriesUrl = `?show=entries&source=${encodeURIComponent(row.source)}&file=${encodeURIComponent(row.file)}&line=${encodeURIComponent(row.line)}&col=${encodeURIComponent(row.col)}`;
    const editorUrl  = editorLink(row.file, row.line, row.col);
    tableRows += `
<tr u2-href>
  <td style="width:3rem; white-space:nowrap">
    <small class=u2-badge style="background-color:${color}">${hee(row.prio || "?")}</small> <small>${num}x</small>
  <td style="width:6rem">
    <a href="${hee(entriesUrl)}">${hee(String(row.num_ip))} IPs</a>
  <td style="width:6rem">
    ${hee(row.source)}
  <td style="width:6rem; white-space:nowrap">
    <small>
      <div style="display:inline-block; border:1px solid; width:30px; vertical-align:middle">
        <div style="height:.6em; width:${num ? Math.round(numBot * 100 / num) : 0}%; background:currentColor"></div>
      </div> bots: ${numBot}
    </small><br>
    <small>
      <div style="display:inline-block; border:1px solid; width:30px; vertical-align:middle">
        <div style="height:.6em; width:${num ? Math.round(numUns * 100 / num) : 0}%; background:currentColor"></div>
      </div> oldies: ${numUns}
    </small>
  <td>
    <a target="_blank" href="${hee(editorUrl)}">${hee(msg.slice(0, 300))}${msg.length > 300 ? "…" : ""}</a><br>
    <small>${u2time(row.time)}</small>
    <div>${hee(row.usr_email ?? "")}</div>
  <td>
    <button class=u2-unstyle type=button
      data-delete-group
      data-source="${hee(String(row.source))}"
      data-file="${hee(String(row.file))}"
      data-line="${hee(String(row.line))}"
      data-col="${hee(String(row.col))}"
      aria-label="Delete"><u2-ico icon=delete aria-hidden="true">✕</u2-ico></button>`;
  }

  return `
<table class=u2-table>
  <tbody style="vertical-align:baseline">
    ${tableRows}
</table>`;
}

async function renderEntryList(node: Node, ctx: Ctx, get: Record<string, string>): Promise<string> {
  const db = node.app.db;
  const { editorLink, fileDisplay } = makeFileHelper(ctx);

  if (!["source", "file", "line", "col"].some(k => get[k] !== undefined)) return `<div>${await node.app.t`Invalid parameters`}</div>`;
  const where = groupWhere(get);

  const rows = await db.query`
    SELECT e.*, usr.email
    FROM m_error_report e
      LEFT JOIN log  ON e.log_id   = log.id
      LEFT JOIN sess ON log.sess_id = sess.id
      LEFT JOIN usr  ON sess.usr_id = usr.id
    WHERE ${where} ORDER BY e.time DESC LIMIT 200`;

  let tableRows = "";
  const u = ctx.req.url.toURL();
  for (const row of rows) {
    const eUrl = editorLink(row.file ?? "", row.line, row.col);

    let btHtml = "";
    const bt = row.backtrace ? JSON.parse(row.backtrace) : [];
    for (const item of bt) {
      btHtml += `<tr>
  <td style="padding-right:1rem"><a href="${hee(editorLink(item.file ?? "", item.line, item.col))}" target="_blank">${hee(fileDisplay(item.file ?? ""))}</a>
  <td style="padding-right:1rem">${hee(item.function ?? "")}
  <td>${hee(item.args ? JSON.stringify(item.args) : "")}`;
    }

    u.searchParams.set("id", String(row.id));
    tableRows += `
<tr style="white-space:nowrap">
  <td>
    <a href="${hee(u.search)}">${u2time(row.time)} <br> ${hee(String(row.log_id ?? ""))}</a>
    <br><button onclick="cmsApi(${node.id},{delete:{id:'${hee(String(row.id))}'}}); this.disabled=true">delete</button>
  <td>
    <b>${hee(row.message ?? "")}</b><br>
    <a href="${hee(row.request ?? "")}" target="_blank">${hee(row.request ?? "")}</a><br>
    <a href="${hee(row.referer ?? "")}" target="_blank">${hee(row.referer ?? "")}</a><br>
    <small>${hee(row.browser ?? "")}</small>
    <br>${hee(row.ip ?? "")}
    <br>${hee(row.email ?? "")}
  <td>
    <a href="${hee(eUrl)}" target="_blank" title="${hee(row.file ?? "")}" style="color:inherit; text-decoration:none">
      ${row.sample ? `<pre style="font-size:10px; box-shadow:0 0 5px; padding:4px">${hee(row.sample)}</pre>` : "edit File"}
    </a>
  <td>${bt.length ? `<table>${btHtml}</table>` : ""}`;
  }

  return `
<div class=u2-card style="height:88vh; overflow:auto; flex:1 1 80rem">
  <div class=-head><a href="?">← ${await node.app.t`Errors`}</a> &nbsp; ${hee(get.file ?? "")} : ${hee(get.line ?? "")} : ${hee(get.col ?? "")}</div>
  <table class=u2-table>
    <tbody style="vertical-align:baseline">
      ${tableRows}
  </table>
</div>`;
}

async function renderDetail(node: Node, id: number): Promise<string> {
  const { t, db } = node.app;
  const ctx = getCtx();
  const get = ctx.req.query;
  const { editorLink, fileDisplay } = makeFileHelper(ctx);

  const error = await db.row`SELECT * FROM m_error_report WHERE id = ${id}`;
  if (!error) return `<div>${await t`Error entry not found`}</div>`;

  const log  = error.log_id ? await db.row`SELECT * FROM log WHERE id = ${error.log_id}` : null;
  const sess = log?.sess_id  ? await db.row`SELECT * FROM sess WHERE id = ${log.sess_id}` : null;
  const usr  = sess?.usr_id  ? await db.row`SELECT * FROM usr  WHERE id = ${sess.usr_id}` : null;

  let btHtml = "";
  const bt = error.backtrace ? JSON.parse(error.backtrace) : [];
  for (const item of bt) {
    const isLocal = ctx.urlToLocalPath(item.file ?? "") !== null;
    const fileCell = isLocal
      ? `<a href="${hee(editorLink(item.file, item.line, item.col))}" target="_blank">${hee(fileDisplay(item.file ?? ""))} <span style="opacity:.6">: ${hee(String(item.line ?? ""))}${item.col ? " : " + hee(String(item.col)) : ""}</span></a>`
      : `${hee(item.file ?? "")} <span style="opacity:.6">: ${hee(String(item.line ?? ""))}${item.col ? " : " + hee(String(item.col)) : ""}</span>`;
    btHtml += `
<tr>
  <td>${fileCell}
  <td>${hee(item.function ?? "")}
  <td>${hee(item.args ? JSON.stringify(item.args) : "")}`;
  }

  const historyOf = get.history_of ?? "ip";
  let historyWhere: Sql | null = null;
  if      (historyOf === "ip"     && error.ip)       historyWhere = sql`log.ip_id IN (SELECT id FROM log_ip WHERE ip = ${error.ip})`;
  else if (historyOf === "sess"   && log?.sess_id)   historyWhere = sql`log.sess_id = ${log.sess_id}`;
  else if (historyOf === "client" && log?.client_id) historyWhere = sql`log.client_id = ${log.client_id}`;

  let historyRows = "";
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
      let errorLinks = "";
      for (const eItem of errorItems) {
        const active = eItem.id === error.id ? "&#x25B6;&#xFE0E;" : "";
        eu.searchParams.set("id", String(eItem.id));
        errorLinks += `<a style="color:var(--red); border:1px solid; border-width:1px 0; padding:3px 0; margin-bottom:-1px; display:block" href="${hee(eu.search)}">${active} ${hee(eItem.message)}</a>`;
      }
      historyRows += `
<tr>
  <td>${u2time(item.time)} <br> Session: ${hee(String(item.sess_id ?? ""))} <br> Log-ID: ${hee(String(item.id))}
  <td>
    <a href="${hee(item.url ?? "")}" target="_blank">${hee(item.url ?? "")}</a><br>
    <div style="font-size:.9em; color:#aaa">${hee(item.referer ?? "")}</div>
    ${errorLinks}
  <td><div style="max-width:600px; overflow:auto">${hee(item.post ?? "")}</div>`;
    }
  }

  const hu = ctx.req.url.toURL(); hu.searchParams.set("id", String(id));
  const histHref = (h: string) => { hu.searchParams.set("history_of", h); return hee(hu.search); };
  const historyLinks = `
<a href="${histHref("ip")}">IP</a>
${log ? `<a href="${histHref("sess")}">Session</a> | <a href="${histHref("client")}">Client</a>` : ""}`;

  const isLocalFile = ctx.urlToLocalPath(error.file ?? "") !== null;
  const fileBlock = isLocalFile
    ? `<a style="color:inherit; text-decoration:none" target="_blank" href="${hee(editorLink(error.file, error.line, error.col))}">
      <b>${hee(fileDisplay(error.file ?? ""))}</b> line: ${hee(String(error.line))} column: ${hee(String(error.col))}
      ${error.sample ? `<pre style="box-shadow:0 0 10px; padding:10px">${hee(error.sample)}</pre>` : ""}
    </a>`
    : `<b>${hee(error.file)}</b> line: ${hee(String(error.line))} column: ${hee(String(error.col))}
    ${error.sample ? `<pre style="box-shadow:0 0 10px; padding:10px">${hee(error.sample)}</pre>` : ""}`;

  return `
<div class="u2-flex" style="font-size:.95em">
  <div class="u2-card" style="overflow:auto; width:auto; flex:1 1 20rem">
    <div class="-head">${await t`Error`}</div>
    <div class="-body">
      <p>
        <span style="color:var(--red)">${hee(error.source)} ${hee(error.prio)}:</span>
        ${hee(error.message)}
      </p>
      ${fileBlock}
    </div>
    <table class="u2-table">
      <tr><th>${await t`Id`}<td>${error.id}
      <tr><th>${await t`Request`}<td>
        <a href="${hee(error.request ?? "")}">${hee(error.request ?? "")}</a><br>
        <small>${await t`Referer`} <a href="${hee(error.referer ?? "")}">${hee(error.referer ?? "")}</a></small>
      <tr><th>${await t`Browser`}<td><small>${hee(error.browser ?? "")}</small>
      <tr><th>${await t`Time`}<td>${u2time(error.time)} <small>(Log-ID ${error.log_id ?? ""})</small>
      <tr><th>${await t`IP`}<td>${hee(error.ip ?? "")}
    </table>
    <div class="-body">
      ${sess ? `<b>Sess</b><pre>${hee(JSON.stringify(sess, null, 2))}</pre>` : ""}
      <button onclick="cmsApi(${node.id},{delete:{id:'${hee(String(error.id))}'}}); this.disabled=true">delete</button>
    </div>
  </div>

  <div class="u2-card" style="overflow:auto;">
    <div class="-head">${await t`Backtrace`}</div>
    <table class="u2-table">
      <thead><tr><th>${await t`File`}<th>${await t`Function`}<th>${await t`Arguments`}
      <tbody>${btHtml}
    </table>
  </div>

  <div class="u2-card" style="overflow:auto;">
    <div class="-head">${await t`User`}</div>
    <div class="-body">
      ${usr ? `<pre>${hee(JSON.stringify(usr, null, 2))}</pre>` : `(${await t`no user`})`}
    </div>
  </div>

  <div class="u2-card" style="overflow:auto;">
    <div class="-head">${await t`History`}</div>
    <div class="-body" style="flex-grow:0">${await t`History of:`} ${historyLinks}</div>
    <table class="u2-table">
      <thead><tr><th>${await t`Time / Session`}<th>${await t`URL / Referer`}<th>${await t`POST`}
      <tbody>${historyRows}
    </table>
  </div>
</div>`;
}

export async function backendDashboardWidget(app: App): Promise<string> {
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

  if (!rows.length) return `<span style="color:var(--green)">&#10003; No entries (last 7 days)</span>`;

  const errNode = await cmsOf(app).nodeByModule("cms.backend.superuser.error_report");
  const baseUrl = errNode ? await errNode.url() : null;

  const color: Record<string, string> = { error: "var(--red)", warning: "var(--orange)", notice: "var(--gray)" };
  let tableRows = "";
  for (const row of rows) {
    const c = color[row.prio] ?? "#333";
    const qs = "?show=entries&source=" + encodeURIComponent(row.source) + "&file=" + encodeURIComponent(row.file) + "&line=" + encodeURIComponent(row.line) + "&col=" + encodeURIComponent(row.col);
    const detailUrl = baseUrl ? hee(baseUrl.replace(/(#|$)/, qs + "$1")) : null;
    const msg = `<span style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block">${hee(row.message)}</span>`;
    tableRows += `<tr>
    <td><span style="color:${c};font-weight:bold">${hee(row.prio)}</span>
    <td>${hee(row.source)}
    <td>${detailUrl ? `<a href="${detailUrl}">${msg}</a>` : msg}
    <td style="color:#888">${hee(String(row.num))}x`;
  }

  return `<div style="overflow:auto; padding:0">
<table class="u2-table" style="width:100%">
  <thead><tr><th>Prio<th>Source<th>Message<th>Anzahl
  <tbody>${tableRows}
</table></div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    parts: { list },
  },
};
