import { dump } from "@nuxodin/dump";
import { html, getCtx, sql, unixTime } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import * as u2 from "@qino/qino/u2";

import manifest from "./manifest.json" with { type: "json" };

import type { Sql, Ctx, App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Requests", de: "Anfragen" });
}

// deterministic color from any value (clients, IPs, users …)
const uniqueColor = (v: unknown): string => {
  const s = String(v ?? "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 55% 45%)`;
};

// render any value via dump.js; parse JSON strings (e.g. stored POST bodies) first
const dumpData = (raw: unknown): HtmlString => {
  if (raw == null || raw === "") return html`-`;
  let val = raw;
  if (typeof raw === "string") { try { val = JSON.parse(raw); } catch { return html`<pre>${raw}</pre>`; } }
  return html.raw(dump(val));
};

// tables holding a reference to a log row (stamped by core on every write)
function logRefColumns(db: App["db"]): { table: string; col: string }[] {
  const out = [];
  const tables = (db.schema?.properties ?? {}) as Record<string, { additionalProperties?: { properties?: Record<string, unknown> } }>;
  for (const [table, def] of Object.entries(tables)) {
    const cols = def?.additionalProperties?.properties ?? {};
    for (const col of ["log_id", "log_id_ch"]) if (cols[col]) out.push({ table, col });
  }
  return out;
}

// ── list (filterable part) ────────────────────────────────────────────────
async function list(node: Node, { ctx, vars = {} }: { ctx: Ctx; vars?: Record<string, unknown> }): Promise<HtmlString> {
  const { t, db } = node.app;
  const f = (vars.filter ?? {}) as Record<string, string>;

  const where = [sql`${true}`];
  if (f.id)            where.push(sql`log.id = ${Number(f.id)}`);
  if (f.not_my_client) where.push(sql`log.client_id != ${ctx.clientId}`);
  if (f.loggedin === "yes") where.push(sql.raw("usr.id IS NOT NULL"));
  if (f.loggedin === "no")  where.push(sql.raw("usr.id IS NULL"));
  if (f.from)          where.push(sql`log.time >= ${backend.toUnix(f.from)}`);
  if (f.to)            where.push(sql`log.time <= ${backend.toUnix(f.to)}`);
  // Search hits a single indexed path (never an OR across joined tables, which would
  // force a full log scan). Input shape decides the dimension: number → id/client,
  // dotted/colon → ip (via unique log_ip), else → url (fulltext on the small log_url).
  if (f.search) {
    const s = f.search.trim();
    if (/^\d+$/.test(s)) {
      where.push(sql`(log.id = ${Number(s)} OR log.client_id = ${Number(s)} OR log.sess_id = ${Number(s)})`); // same table → index merge
    } else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s) || s.includes(":")) {
      where.push(sql`log.ip_id = (SELECT id FROM log_ip WHERE ip = ${s})`);
    } else if (db.dialect === "mysql") {
      where.push(sql`log.url_id IN (SELECT id FROM log_url WHERE MATCH(url) AGAINST (${s + "*"} IN BOOLEAN MODE))`);
    } else {
      where.push(sql`log.url_id IN (SELECT id FROM log_url WHERE url LIKE ${"%" + s + "%"})`);
    }
  }

  const rows = await db.query`
    SELECT log.id, log.client_id, log.sess_id, log.time, log.post,
            ip.ip AS ip, url.url AS url, referer.url AS referer,
            usr.id AS usr_id, usr.username, usr.given_name, usr.family_name, ua.user_agent
     FROM log
        LEFT JOIN log_url url        ON log.url_id        = url.id
        LEFT JOIN log_url referer    ON log.referer_id    = referer.id
        LEFT JOIN sess               ON log.sess_id       = sess.id
        LEFT JOIN usr                ON sess.usr_id       = usr.id
        LEFT JOIN log_ip ip          ON log.ip_id         = ip.id
        LEFT JOIN log_user_agent ua  ON log.user_agent_id = ua.id
     WHERE ${sql.join(where, " AND ")}
     ORDER BY log.id DESC LIMIT 1400`.catch(() => []);

  const u = ctx.req.url.toURL();
  const ownHost = ctx.req.url.host;
  const trs = [];
  for (const row of rows) {
    u.searchParams.set("id", String(row.id));
    const own = String(row.client_id) === String(ctx.clientId);
    const info = backend.uaInfo(row.user_agent ?? "");
    // referer is red only when it comes from another host (compare origins, not paths)
    let foreignRef = false;
    if (row.referer) { try { foreignRef = new URL(row.referer).host !== ownHost; } catch { foreignRef = true; } }
    const post = row.post ? (row.post.length >= 2000 ? "(too big)" : row.post) : "";
    trs.push(html`
<tr u2-href>
    <td style="white-space:nowrap"><a href="${u.search}">${u2.el.time(row.time)}</a>
    <td>
        <div class=-url>${row.url}</div>
        <small class=-url${foreignRef ? html.raw(' style="color:var(--red)"') : ""}>${row.referer}</small>
    <td style="text-align:center; white-space:nowrap">
        ${own
          ? html`<small class=u2-badge>${row.client_id}</small>`
          : html`<span style="color:${uniqueColor(row.client_id)}">${row.client_id}</span>`}<br>
        <small style="color:${uniqueColor(info.browser)}">${info.browser} ${info.version}</small>
        ${info.bot ? html`<br><small class=u2-badge>bot</small>` : ""}
    <td>${row.usr_id ? html`<span style="color:${uniqueColor(row.usr_id)}">${(row.given_name ?? "") + " " + (row.family_name ?? "")}</span><br><small>${row.username}</small>` : html`<small>guest</small>`}
    <td style="color:${uniqueColor(row.ip)}; white-space:nowrap">${row.ip}
    <td>${post ? html`<pre style="max-width:25rem; max-height:6rem; overflow:auto">${post}</pre>` : "-"}
    <td>${row.id}`);
  }

  // returns only the table's inner content — the <table cms-part=list> wrapper lives in render()
  return html.async`
<thead><tr style="vertical-align:top">
    <th>${t`Time`}
    <th>${t`Url / Referer`}
    <th>${t`Client`}
    <th>${t`User`}
    <th>${t`IP`}
    <th>${t`POST`}
    <th>ID
<tbody style="vertical-align:top">${trs.length ? trs : html`<tr><td colspan=7>${await t`No entries`}`}`;
}

// ── stats + maintenance ─────────────────────────────────────────────────────
async function tableStats(node: Node): Promise<{ rows: number; mb: number | null }> {
  const db = node.app.db;
  if (db.dialect === "mysql") {
    const r = await db.row`
      SELECT TABLE_ROWS AS row_count, round((data_length + index_length) / 1024 / 1024, 2) AS mb
       FROM information_schema.TABLES WHERE table_schema = DATABASE() AND TABLE_NAME = 'log'`.catch(() => undefined);
    if (r) return { rows: Number(r.row_count) || 0, mb: r.mb == null ? null : Number(r.mb) };
  }
  const rows = Number(await db.one`SELECT count(*) FROM log`.catch(() => 0)) || 0;
  return { rows, mb: null };
}

async function runTool(node: Node, doName: string, data: Record<string, unknown>): Promise<HtmlString> {
  const { t, db } = node.app;
  const before = Number(data.before) || 0;
  const limit = Number(data.limit) || 0;
  const t0 = performance.now();
  let msg = "";

  if (doName === "clean_data") {
    // blank stored POST bodies, keep the request rows
    const r = await db.exec`UPDATE log SET post = '' WHERE post != ''${before ? sql` AND time < ${before}` : sql.raw("")}`;
    msg = `${r.affectedRows} ${await t`entries processed`}`;
  } else if (doName === "clean_items") {
    const cond = [sql`${true}`];
    if (before) cond.push(sql`time < ${before}`);
    if (data.check_if_used) {
      const refs = logRefColumns(db);
      if (refs.length) {
        const union = sql.join(refs.map((r) => sql`SELECT ${sql.id(r.col)} AS id FROM ${sql.id(r.table)} WHERE ${sql.id(r.col)} IS NOT NULL`), " UNION ");
        cond.push(sql`log.id NOT IN (${union})`);
      }
    }
    const inner = sql`SELECT id FROM log WHERE ${sql.join(cond, " AND ")} ORDER BY id DESC${limit ? sql` LIMIT ${limit}` : sql.raw("")}`;
    const r = await db.exec`DELETE FROM log WHERE id IN (SELECT id FROM (${inner}) x)`;
    msg = `${r.affectedRows} ${await t`entries processed`}`;
  } else if (doName === "optimize") {
    if (db.dialect === "mysql") { await db.exec`OPTIMIZE TABLE log`; msg = await t`Table optimized`; }
    else if (db.dialect === "sqlite") { await db.exec`VACUUM`; msg = await t`Table optimized`; }
    else msg = await t`Not supported for this database`;
  }
  return html`${msg}<br><small>${((performance.now() - t0) / 1000).toFixed(2)} sec.</small>`;
}

// ── render ──────────────────────────────────────────────────────────────────
async function render(node: Node, { ctx, vars = {} }: { ctx: Ctx; vars?: Record<string, unknown> }): Promise<HtmlString> {
  if (ctx.req.query.id) return renderDetail(node, Number(ctx.req.query.id));
  const { t } = node.app;

  const message = vars.do ? await runTool(node, String(vars.do), (vars.data ?? {}) as Record<string, unknown>) : "";
  const stats = await tableStats(node);
  const int = (n: number) => n.toLocaleString("de-CH");

  const DAY = 86400;
  const now = unixTime();
  const ages = [
    [now - DAY * 366 * 5, await t`older than 5 years`],
    [now - DAY * 366, await t`older than 1 year`],
    [now - DAY * 183, await t`older than 6 months`],
    [now - DAY * 31, await t`older than 1 month`],
    [now - DAY * 7, await t`older than 1 week`],
    ["", await t`all`],
  ] as const;
  const ageOptions = (sel: number) =>
    ages.map((a, i) => html`<option value="${a[0]}"${i === sel ? " selected" : ""}>${a[1]}`);

  // ?search= prefills the box (used by the detail page's client/session/ip links)
  const initSearch = String(ctx.req.query.search ?? "");
  const initialList = await list(node, { ctx, vars: { filter: { search: initSearch } } });

  // single root element — the CMS injects qcms-id/qcms-mod into the first tag, so the
  // <style> must live inside it (otherwise el would be the <style> and querySelector misses the form)
  return html.async`<div class=u2-flex>
    <style>[cms-part=list] .-url { display:block; max-width:40rem; white-space:nowrap; text-overflow:ellipsis; overflow:hidden }</style>
    <div class=u2-card style="flex:1 1 100%">
        <div class=-head>${t`Filter`}</div>
        <div class=-body>
            <form data-filter class=u2-flex style="gap:.5em 1em; align-items:end">
                <label>${t`Search`}<br><input name=search value="${initSearch}" placeholder="${t`URL, IP, ID`}"></label>
                <label>ID<br><input type=number name=id></label>
                <label>${t`Logged in`}<br><select name=loggedin><option value=""><option value=yes>${t`yes`}<option value=no>${t`no`}</select></label>
                <label>${t`from`}<br><input type=datetime-local name=from></label>
                <label>${t`to`}<br><input type=datetime-local name=to></label>
                <label><input type=checkbox name=not_my_client value=1> ${t`not my client`}</label>
            </form>
        </div>
    </div>

    <div class=u2-card style="flex:0 0 auto; max-height:88vh; overflow:auto">
        <div class=-head>${t`Tools`}</div>
        <div class=-body style="flex-grow:0">
            ${message ? html`<p>${message}</p><hr>` : ""}
            <table class=u2-table>
                <tr><td>${t`Entries`}<td style="text-align:right">${int(stats.rows)}
                ${stats.mb == null ? "" : html`<tr><td>${await t`Size`}<td style="text-align:right">${int(stats.mb)} MB`}
            </table>
            <hr>
            <form data-tool=clean_data>
                <b>${t`Delete POST data`}</b><br>
                <select name=before>${ageOptions(3)}</select><br>
                <button style="width:100%">${t`Delete POST data`}</button>
            </form>
            <hr>
            <form data-tool=clean_items>
                <b>${t`Delete entries`}</b><br>
                <select name=before>${ageOptions(3)}</select><br>
                <label><input type=checkbox name=check_if_used value=1 checked> ${t`keep if referenced`}</label><br>
                <button style="width:100%">${t`Delete entries`}</button>
            </form>
            <hr>
            <button data-reload='{"do":"optimize"}'>${t`Optimize table`}</button>
        </div>
    </div>

    <div class=u2-card style="flex:1 1 60rem; max-height:88vh; overflow:auto">
        <div class=-head>Log</div>
        <table class=u2-table cms-part=list>${initialList}</table>
    </div>
</div>`;
}

// ── detail ──────────────────────────────────────────────────────────────────
async function renderDetail(node: Node, id: number): Promise<HtmlString> {
  const { t, db } = node.app;
  const ctx = getCtx();
  if (!id) return html`<div>${await t`Not found`}</div>`;

  const log = await db.row`
    SELECT log.*, url.url AS url, referer.url AS referer, ip.ip AS ip, ua.user_agent AS user_agent
     FROM log
        LEFT JOIN log_url url       ON log.url_id        = url.id
        LEFT JOIN log_url referer   ON log.referer_id    = referer.id
        LEFT JOIN log_ip ip         ON log.ip_id         = ip.id
        LEFT JOIN log_user_agent ua ON log.user_agent_id = ua.id
     WHERE log.id = ${id}`;
  if (!log) return html`<div>${await t`Not found`}</div>`;

  const sess = log.sess_id ? await db.row`SELECT * FROM sess WHERE id = ${log.sess_id}` : null;
  const usr = sess?.usr_id ? await db.row`SELECT * FROM usr WHERE id = ${sess.usr_id}` : null;
  const info = backend.uaInfo(log.user_agent ?? "");

  // relations: rows in other tables referencing this log entry
  const relationTrs = [];
  for (const { table, col } of logRefColumns(db)) {
    const refRows = await db.query`SELECT * FROM ${sql.id(table)} WHERE ${sql.id(col)} = ${id}`.catch(() => []);
    if (refRows.length) {
      relationTrs.push(html`<tr>
        <td>${table}
        <td>${col}
        <td><div style="max-width:50rem; max-height:30rem; overflow:auto">${html.raw(dump(refRows))}</div>`);
    }
  }

  // history of session / client / ip
  const historyOf = ctx.req.query.history_of ?? "sess";
  let hWhere: Sql | null = null;
  if (historyOf === "client" && log.client_id) hWhere = sql`log.client_id = ${log.client_id}`;
  else if (historyOf === "ip" && log.ip_id) hWhere = sql`log.ip_id = ${log.ip_id}`;
  else if (log.sess_id) hWhere = sql`log.sess_id = ${log.sess_id}`;

  const historyTrs = [];
  if (hWhere) {
    const logs = await db.query`
      SELECT log.id, log.time, log.post, url.url AS url, referer.url AS referer
       FROM log
          LEFT JOIN log_url url     ON log.url_id     = url.id
          LEFT JOIN log_url referer ON log.referer_id = referer.id
       WHERE ${hWhere} AND log.id <= ${id} ORDER BY log.id DESC LIMIT 100`.catch(() => []);
    const u = ctx.req.url.toURL();
    for (const item of logs) {
      u.searchParams.set("id", String(item.id));
      historyTrs.push(html`<tr u2-href${item.id === id ? " aria-current=true" : ""}>
        <td style="white-space:nowrap"><a href="${u.search}">${u2.el.time(item.time)}</a><br><small>${item.id}</small>
        <td><a href="${item.url}" target=_blank>${item.url}</a><br><small>${item.referer}</small>
        <td>${item.post ? html`<pre style="max-width:30rem; max-height:8rem; overflow:auto">${item.post}</pre>` : "-"}`);
    }
  }
  const hu = ctx.req.url.toURL(); hu.searchParams.set("id", String(id));
  const histLink = (h: string, label: string) => { hu.searchParams.set("history_of", h); return html`<a href="${hu.search}">${label}</a>`; };

  // links back to the filtered list (drop id/history_of so render() shows the list, not the detail)
  const lu = ctx.req.url.toURL(); lu.searchParams.delete("id"); lu.searchParams.delete("history_of");
  const searchLink = (v: unknown) => { lu.searchParams.set("search", String(v)); return lu.search; };

  return html.async`
<div class=u2-flex>
    <div class=u2-card style="flex:0 0 auto; overflow:auto">
        <div class=-head>Log ${id}</div>
        <table class=u2-table>
            <tr>
              <th>${t`Request`}
              <td><a href="${log.url}" target=_blank>${log.url}</a><br>
                  <small>Referer <a href="${log.referer}" target=_blank>${log.referer}</a></small>
            <tr>
              <th>${t`Browser`}
              <td>${info.browser} ${info.version} ${info.bot ? html`<small class=u2-badge>bot</small>` : ""}
                  <br><small>${log.user_agent}</small>
            <tr><th>${t`Time`}<td>${u2.el.time(log.time)}
            <tr>
              <th style="color:${uniqueColor(log.ip)}">${t`IP`}
              <td>${log.ip ? html`<a href="${searchLink(log.ip)}">${log.ip}</a>` : "-"}
            <tr>
              <th>${t`Client`}
              <td><a href="${searchLink(log.client_id)}" style="color:${uniqueColor(log.client_id)}">${log.client_id}</a>
            <tr><th>${t`Session`}<td><a href="${searchLink(log.sess_id)}">${log.sess_id}</a>
            <tr>
              <th>${t`User`}
              <td>${usr ? html`${(usr.given_name ?? "") + " " + (usr.family_name ?? "")} <small>#${usr.id}</small>
                  <br><small>${usr.username}</small>` : "guest"}
            <tr><th>POST<td><div style="max-width:40rem; max-height:30rem; overflow:auto">${dumpData(log.post)}</div>
        </table>
    </div>

    <div class=u2-card style="flex:0 0 auto; overflow:auto">
        <div class=-head>${t`Relations`}</div>
        <table class=u2-table><tbody style="vertical-align:top">${relationTrs.length ? relationTrs : html`<tr><td>${await t`No entries`}`}</table>
    </div>

    <div class=u2-card style="flex:1 1 40rem; max-height:88vh; overflow:auto">
        <div class=-head>${t`History`}</div>
        <div class=-body style="flex-grow:0">${t`History of:`}
            ${histLink("sess", await t`Session`)} | ${histLink("client", await t`Client`)} | ${histLink("ip", "IP")}</div>
        <table class=u2-table><tbody style="vertical-align:top">${historyTrs}</table>
    </div>
</div>`;
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const db = app.db;
  const since = unixTime() - 86400;
  const total = Number(await db.one`SELECT count(*) FROM log WHERE time >= ${since}`.catch(() => 0)) || 0;
  const users = Number(await db.one`SELECT count(DISTINCT sess.usr_id) FROM log JOIN sess ON log.sess_id = sess.id WHERE log.time >= ${since} AND sess.usr_id IS NOT NULL`.catch(() => 0)) || 0;
  return html.async`<div class=-body>
    <b>${total.toLocaleString("de-CH")}</b> ${app.t`requests (24h)`}<br>
    <small>${users} ${app.t`logged-in users`}</small>
</div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    parts: { list },
  },
};
