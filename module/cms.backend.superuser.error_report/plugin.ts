import { hee, getCtx, sql, u2time, type Sql, type RequestContext, type App } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.backend.superuser.error_report";
export const needs = ["cms.backend", "error_report"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.superuser.error_report", { en: "Errors", de: "Fehler" });
}

function makeFileHelper(ctx: RequestContext) {
  const appURL = ctx.appURL;
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
  const get = ctx.get;

  if (vars.delete) {
    const where = db.table("m_error_report").valuesToFragment(vars.delete);
    if (where.parts.length) await db.exec`DELETE FROM m_error_report WHERE ${where}`;
  }
  if (vars.delete_foreign_js) {
    const host = ctx.req.header("host") ?? "";
    await db.query`DELETE FROM m_error_report WHERE source = 'js' AND file NOT LIKE '/_%' AND file NOT LIKE ${"http://" + host + "%"} AND file NOT LIKE ${"https://" + host + "%"}`;
  }
  if (vars.deleteAll) {
    await db.query`DELETE FROM m_error_report`;
  }

  if (get.id) return renderDetail(node, Number(get.id));

  const order    = get.order ?? "max_id";
  const orderSql = order !== "num_ip" ? "g.max_id DESC" : "g.num_ip DESC, g.num DESC";

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
        sum(bot)                   AS num_bot,
        sum(unsupported_ua)        AS num_unsupported
      FROM m_error_report
      GROUP BY source, file, line, col
    ) g
      JOIN m_error_report e ON e.id = g.max_id
      LEFT JOIN log  ON e.log_id   = log.id
      LEFT JOIN sess ON log.sess_id = sess.id
      LEFT JOIN usr  ON sess.usr_id = usr.id
    ORDER BY ${sql.raw(orderSql)}`;

  const sortU = ctx.url; sortU.searchParams.delete("id");
  const sortHref = (o: string) => { sortU.searchParams.set("order", o); return hee(sortU.search); };

  const tools = `
<div class="u2-card" style="flex-grow:0">
  <div class="-head">${await t`Tools`}</div>
  <div class="-body">
    ${order === "num_ip"
      ? `<a href="${sortHref("max_id")}">${await t`sort by date`}</a><br>`
      : `<a href="${sortHref("num_ip")}">${await t`sort by number of IPs`}</a><br>`}
    <br>
    ${await t`Delete`}:<br>
    <button data-reload='{"delete":{"bot":"1","source":"404"}}'>${await t`404 and bots`}</button><br>
    <button data-reload='{"delete":{"unsupported_ua":"1","source":"404"}}'>${await t`404 and old browsers`}</button><br>
    <button data-reload='{"delete":{"referer":"","source":"404"}}'>${await t`404 no referer`}</button><br>
    <button data-reload='{"delete":{"bot":"1","source":"js"}}'>${await t`js and bots`}</button><br>
    <button data-reload='{"delete":{"unsupported_ua":"1","source":"js"}}'>${await t`js and old browsers`}</button><br>
    <button data-reload='{"delete":{"file":"","source":"js"}}'>${await t`js no file`}</button><br>
    <button data-reload='{"delete_foreign_js":true}'>${await t`js, foreign`}</button><br>
    <button data-reload='{"delete":{"source":"404"}}'>${await t`delete 404`}</button><br>
    <button data-reload='{"delete":{"source":"net"}}'>${await t`delete net`}</button><br>
    <button data-reload='{"delete":{"source":"perf"}}'>${await t`delete perf`}</button><br>
    <button data-reload='{"delete":{"prio":"notice","source":"csp"}}'>${await t`csp read-only`}</button><br>
    <button data-reload='{"delete":{"prio":"notice"}}'>${await t`Notices`}</button><br>
    <button data-reload='{"deleteAll":1}'>${await t`Delete all entries`}</button><br>
  </div>
</div>`;

  if (!rows.length && get.show !== "entries") {
    return `<div class="u2-flex">${tools}<div class="u2-card"><div class="-body">${await t`Great, no errors so far!`}</div></div></div>`;
  }

  if (get.show === "entries") {
    const entriesBox = await renderEntryList(node, ctx, get);
    return `<div class="u2-flex">${tools}${entriesBox}</div>`;
  }

  const { editorLink } = makeFileHelper(ctx);
  let tableRows = "";
  for (const row of rows) {
    const color   = ({ error: "var(--red)", warning: "var(--orange)", notice: "var(--blue)" } as Record<string, string>)[String(row.prio)] ?? "var(--gray)";
    const num     = Number(row.num)     || 0;
    const numBot  = Number(row.num_bot) || 0;
    const numUns  = Number(row.num_unsupported) || 0;
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
    <a target="_blank" href="${hee(editorUrl)}">${hee(row.message)}</a><br>
    <small>${u2time(row.time)}</small>
    <div>${hee(row.usr_email ?? "")}</div>
  <td>
    <u2-ico
      data-delete-entry
      data-file="${hee(row.file)}"
      data-line="${hee(String(row.line))}"
      data-col="${hee(String(row.col))}"
      icon=delete
      aria-label="Delete"
      style="cursor:pointer">✕</u2-ico>`;
  }

  return `
<div class="u2-flex">
  ${tools}
  <div class=u2-card style="max-height:88vh; overflow:auto; flex:1 1 80rem">
    <div class=-head>${await t`Errors`}</div>
    <table class=u2-table>
      <tbody style="vertical-align:baseline">
        ${tableRows}
    </table>
  </div>
</div>`;
}

async function renderEntryList(node: Node, ctx: RequestContext, get: Record<string, string>): Promise<string> {
  const db = node.app.db;
  const { editorLink, fileDisplay } = makeFileHelper(ctx);

  const where = db.table("m_error_report").valuesToFragment({ source: get.source, file: get.file, line: get.line, col: get.col });
  if (!where.parts.length) return `<div>${await node.app.t`Invalid parameters`}</div>`;

  const rows = await db.query`
    SELECT e.*, usr.email
    FROM m_error_report e
      LEFT JOIN log  ON e.log_id   = log.id
      LEFT JOIN sess ON log.sess_id = sess.id
      LEFT JOIN usr  ON sess.usr_id = usr.id
    WHERE ${where} ORDER BY e.time DESC LIMIT 200`;

  let tableRows = "";
  const u = ctx.url;
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
  <div class=-head>${hee(get.file ?? "")} : ${hee(get.line ?? "")} : ${hee(get.col ?? "")}</div>
  <table class=u2-table>
    <tbody style="vertical-align:baseline">
      ${tableRows}
  </table>
</div>`;
}

async function renderDetail(node: Node, id: number): Promise<string> {
  const { t, db } = node.app;
  const ctx = getCtx();
  const get = ctx.get;
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

    const eu = ctx.url; eu.searchParams.delete("history_of");
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

  const hu = ctx.url; hu.searchParams.set("id", String(id));
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
      GROUP BY prio, source, file, line, col
    ) g
    JOIN m_error_report e ON e.id = g.max_id
    ORDER BY FIELD(e.prio,'error','warning','notice'), g.max_id DESC
    LIMIT 5`.catch(() => []);

  if (!rows.length) return `<span style="color:var(--green)">&#10003; No entries</span>`;

  const errNode = await app.cms.nodeByModule("cms.backend.superuser.error_report");
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
  },
};
