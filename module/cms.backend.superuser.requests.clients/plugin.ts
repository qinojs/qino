import { getCtx, html, sql, unixTime } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import * as u2 from "@qino/qino/u2";

import manifest from "./manifest.json" with { type: "json" };

import type { App, Ctx, HtmlString, Row } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;
const { uniqueColor, ageColor } = backend;

// Only the newest log rows are scanned (primary key range), so the list stays fast on huge logs.
const WINDOW = 20000;
const LIMIT = 300;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Clients", de: "Besucher" });
}

/** Newest clients with their last request and the request count within the window. */
async function latest(app: App, limit: number, { window = WINDOW, returning = false, exclude = 0 } = {}): Promise<Row[]> {
  const db = app.db;
  const groups = await db.query`
    SELECT client_id, MAX(id) AS last_id, COUNT(*) AS requests
     FROM (SELECT id, client_id FROM log ORDER BY id DESC LIMIT ${window}) recent
     WHERE client_id IS NOT NULL${exclude ? sql` AND client_id != ${exclude}` : sql``}
     GROUP BY client_id${returning ? sql` HAVING COUNT(*) > 1` : sql``}
     ORDER BY last_id DESC LIMIT ${limit}`.catch(() => []);
  if (!groups.length) return [];
  const [logs, users] = await Promise.all([
    db.query`
      SELECT log.id, log.time, ip.ip, url.url, ua.user_agent, usr.id AS usr_id, usr.username, usr.given_name, usr.family_name
       FROM log
          LEFT JOIN log_ip ip         ON log.ip_id         = ip.id
          LEFT JOIN log_url url       ON log.url_id        = url.id
          LEFT JOIN log_user_agent ua ON log.user_agent_id = ua.id
          LEFT JOIN sess              ON log.sess_id       = sess.id
          LEFT JOIN usr               ON sess.usr_id       = usr.id
       WHERE ${sql.in("log.id", groups.map((g) => g.last_id))}`,
    db.query`SELECT client_id, COUNT(*) AS n FROM client_usr WHERE ${sql.in("client_id", groups.map((g) => g.client_id))} GROUP BY client_id`,
  ]);
  const logById = new Map(logs.map((l) => [Number(l.id), l]));
  const usersByClient = new Map(users.map((u) => [Number(u.client_id), Number(u.n)]));
  return groups.map((g) => ({ ...logById.get(Number(g.last_id)), ...g, users: usersByClient.get(Number(g.client_id)) ?? 0 }));
}

/** Badge when the ip is the viewer's own. */
const myIpBadge = (ip: unknown, label: string) => ip && ip === getCtx().req.clientIp ? html` <small class=u2-badge>${label}</small>` : "";

const userName = (row: Row) => [row.given_name, row.family_name].filter(Boolean).join(" ") || row.username;

// ── list (filterable part) ──────────────────────────────────────────────────
async function list(node: Node, { ctx, vars = {} }: { ctx: Ctx; vars?: Record<string, unknown> }): Promise<HtmlString> {
  const { t } = node.app;
  const f = (vars.filter ?? {}) as Record<string, string>;
  const rows = await latest(node.app, LIMIT, { returning: !!f.returning });
  const myIp = await t`my IP`;
  const u = ctx.req.url.toURL();
  const href = (client: unknown) => (u.searchParams.set("id", String(client)), u.search);

  const trs = [];
  for (const row of rows) {
    const info = backend.uaInfo(row.user_agent ?? "");
    if (f.no_bots && info.bot) continue;
    if (f.users && !row.users) continue;
    const own = String(row.client_id) === String(ctx.clientId);
    trs.push(html`<tr u2-href>
    <td><a href="${href(row.client_id)}" style="color:${uniqueColor(row.client_id)}">${row.client_id}</a>${own ? html` <small class=u2-badge>${await t`me`}</small>` : ""}
    <td style="white-space:nowrap" title="${row.user_agent}"><span style="color:${uniqueColor(info.browser)}">${info.browser}</span> <span style="color:${uniqueColor(row.user_agent)}">${info.version}</span> <small>${info.os}${info.mobile ? " 📱" : ""}</small>${info.bot ? html` <small class=u2-badge>bot</small>` : ""}
    <td style="white-space:nowrap"><span style="color:${uniqueColor(row.ip)}">${row.ip}</span>${myIpBadge(row.ip, myIp)}
    <td>${row.usr_id ? html`<span style="color:${uniqueColor(row.usr_id)}">${userName(row)}</span>` : ""}
    <td style="text-align:right">${row.users || ""}
    <td style="text-align:right">${row.requests}
    <td style="white-space:nowrap; color:${ageColor(row.time)}">${u2.el.time(row.time)}
    <td><small style="word-break:break-all">${row.url}</small>`);
  }

  return html.async`
<thead><tr>
    <th>${t`Client`}
    <th>${t`Browser`}
    <th>${t`IP`}
    <th>${t`User`}
    <th>${t`Users`}
    <th>${t`Requests`}
    <th>${t`Last request`}
    <th>${t`Url`}
<tbody>${trs.length ? trs : html`<tr><td colspan=8>${await t`No entries`}`}`;
}

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  if (ctx.req.query.id) return renderDetail(node, Number(ctx.req.query.id));
  const { t } = node.app;
  return html.async`<div class=u2-flex>
    <div class=u2-card style="flex:1 1 60rem">
        <div class=-head>${t`Latest clients`} <small>(${t`last ${WINDOW} requests`})</small></div>
        <div>
            <form data-filter class=u2-flex>
                <label><input type=checkbox name=no_bots value=1> ${t`hide bots`}</label>
                <label><input type=checkbox name=returning value=1 checked> ${t`more than 1 request`}</label>
                <label><input type=checkbox name=users value=1> ${t`with logged-in users`}</label>
            </form>
        </div>
        <div style="overflow:auto; padding:0">
            <table class=u2-table cms-part=list>${list(node, { ctx, vars: { filter: { returning: "1" } } })}</table>
        </div>
    </div>
</div>`;
}

// ── detail ──────────────────────────────────────────────────────────────────
const logRow = (db: App["db"], id: unknown) => db.row`
  SELECT log.id, log.time, ip.ip, url.url, referer.url AS referer, ua.user_agent
   FROM log
      LEFT JOIN log_ip ip         ON log.ip_id         = ip.id
      LEFT JOIN log_url url       ON log.url_id        = url.id
      LEFT JOIN log_url referer   ON log.referer_id    = referer.id
      LEFT JOIN log_user_agent ua ON log.user_agent_id = ua.id
   WHERE log.id = ${id}`;

/** PTR lookup for an IP (v4/v6); anonymized digits ("X") count as 1, like the PHP version. */
async function hostname(ip: unknown): Promise<string> {
  const addr = String(ip ?? "").replaceAll("X", "1");
  let name;
  if (addr.includes(":")) {
    const [head, tail = ""] = addr.split("::");
    const groups = (s: string) => s ? s.split(":") : [];
    const all = [...groups(head), ...Array(8 - groups(head).length - groups(tail).length).fill("0"), ...groups(tail)];
    name = [...all.map((g) => g.padStart(4, "0")).join("")].reverse().join(".") + ".ip6.arpa";
  } else if (/^\d+(\.\d+){3}$/.test(addr)) {
    name = addr.split(".").reverse().join(".") + ".in-addr.arpa";
  } else return "";
  const names = await Deno.resolveDns(name, "PTR", { signal: AbortSignal.timeout(2000) }).catch(() => []);
  return names.map((n) => n.replace(/\.$/, "")).join(", ");
}

const ACTIVE = 900; // a session touched within 15 min counts as active

async function renderDetail(node: Node, id: number): Promise<HtmlString> {
  const { t, db } = node.app;
  const client = id ? await db.row`SELECT * FROM client WHERE id = ${id}` : undefined;
  if (!client) return html.async`<div>${t`Not found`}</div>`;

  const withErrors = !!node.app.modules.linked("error_report");
  const [range, lastUser, users, ips, agents, sessions, errors, logUrl, errorUrl] = await Promise.all([
    db.row`SELECT MIN(id) AS first, MAX(id) AS last, COUNT(*) AS requests, COUNT(DISTINCT sess_id) AS sessions FROM log WHERE client_id = ${id}`,
    client.usr_id ? db.row`SELECT id, username, given_name, family_name FROM usr WHERE id = ${client.usr_id}` : undefined,
    db.query`
      SELECT cu.usr_id, cu.time, cu.save_login, usr.username, usr.given_name, usr.family_name
       FROM client_usr cu JOIN usr ON usr.id = cu.usr_id
       WHERE cu.client_id = ${id} ORDER BY cu.time DESC`,
    db.query`
      SELECT ip.ip, COUNT(*) AS n, MAX(log.time) AS last
       FROM log LEFT JOIN log_ip ip ON log.ip_id = ip.id
       WHERE log.client_id = ${id} GROUP BY ip.ip ORDER BY last DESC LIMIT 50`,
    db.query`
      SELECT ua.user_agent, COUNT(*) AS n, MIN(log.time) AS first, MAX(log.time) AS last
       FROM log LEFT JOIN log_user_agent ua ON log.user_agent_id = ua.id
       WHERE log.client_id = ${id} GROUP BY ua.user_agent ORDER BY last DESC LIMIT 50`,
    db.query`
      SELECT log.sess_id, COUNT(*) AS n, MIN(log.time) AS first, sess.access, usr.id AS usr_id, usr.username, usr.given_name, usr.family_name
       FROM log
          LEFT JOIN sess ON log.sess_id = sess.id
          LEFT JOIN usr  ON sess.usr_id = usr.id
       WHERE log.client_id = ${id} AND log.sess_id IS NOT NULL
       GROUP BY log.sess_id, sess.access, usr.id, usr.username, usr.given_name, usr.family_name
       ORDER BY log.sess_id DESC LIMIT 30`,
    withErrors ? db.query`
      SELECT e.id, e.time, e.source, e.message
       FROM m_error_report e JOIN log ON log.id = e.log_id
       WHERE log.client_id = ${id} ORDER BY e.id DESC LIMIT 50` : [],
    backend.toModuleUrl(node, "cms.backend.superuser.requests.log"),
    backend.toModuleUrl(node, "cms.backend.superuser.error_report"),
  ]);
  const [first, last, host] = await Promise.all([
    range?.first ? logRow(db, range.first) : undefined,
    range?.last ? logRow(db, range.last) : undefined,
    hostname(ips[0]?.ip),
  ]);
  const info = backend.uaInfo(last?.user_agent ?? "");
  const now = unixTime();
  const active = sessions.some((s) => Number(s.access) >= now - ACTIVE);
  const [lastLabel, activeLabel, mobileLabel, desktopLabel, myIp] = await Promise.all([t`last`, t`active`, t`mobile`, t`desktop`, t`my IP`]);
  const user = (row: Row) => html`<span style="color:${uniqueColor(row.usr_id)}">${userName(row)}</span>`;
  const empty = (cols: number) => html.async`<tr><td colspan=${cols}>${t`No entries`}`;
  const link = (href: string, label: unknown) => href ? html`<a href="${href}">${label}</a>` : html`${label}`;

  return html.async`<div class=u2-flex>
    <div class=u2-card style="flex:1 1 30rem">
        <div class=-head>${t`Client`} ${id}</div>
        <table class=u2-table>
            <tr>
              <th>${t`Browser`}
              <td><span style="color:${uniqueColor(info.browser)}">${info.browser}</span> ${info.version} ${info.bot ? html`<small class=u2-badge>bot</small>` : ""}
                  <br><small>${last?.user_agent}</small>
            <tr><th>${t`System`}<td>${info.os || "?"} · ${info.mobile ? mobileLabel : desktopLabel}
            <tr><th>${t`IP`}<td><span style="color:${uniqueColor(last?.ip)}">${last?.ip ?? "-"}</span>${myIpBadge(last?.ip, myIp)}${host ? html`<br><small>${host}</small>` : ""}
            <tr><th>${t`Last user`}<td>${lastUser ? user({ ...lastUser, usr_id: lastUser.id }) : "-"}
            <tr><th>${t`Requests`}<td>${link(logUrl({ search: id }), range?.requests)}
            <tr><th>${t`Sessions`}<td>${range?.sessions}${active ? html` <small class=u2-badge>${activeLabel}</small>` : ""}
            <tr><th>${t`First request`}<td>${first ? html`<span style="color:${ageColor(first.time)}">${u2.el.time(first.time)}</span><br><small style="word-break:break-all">${first.url}</small>` : "-"}
            <tr><th>${t`Origin`}<td><small style="word-break:break-all">${first?.referer || "-"}</small>
            <tr><th>${t`Last request`}<td>${last ? html`<span style="color:${ageColor(last.time)}">${u2.el.time(last.time)}</span><br><small style="word-break:break-all">${last.url}</small>` : "-"}
        </table>
    </div>

    <div class=u2-card style="flex:1 1 30rem">
        <div class=-head>${t`Users`}</div>
        <table class=u2-table>
            <thead><tr>
              <th>${t`User`}
              <th>${t`Date`}
              <th>${t`Stay logged in`}
            <tbody>${users.length ? users.map((row) => html`<tr>
              <td>${user(row)}${Number(row.usr_id) === Number(client.usr_id) ? html` <small class=u2-badge>${lastLabel}</small>` : ""}<br><small>${row.username}</small>
              <td style="white-space:nowrap; color:${ageColor(row.time)}">${row.time ? u2.el.time(row.time) : ""}
              <td>${row.save_login ? "✓" : ""}`) : empty(3)}
        </table>
    </div>

    <div class=u2-card style="flex:1 1 20rem">
        <div class=-head>${t`IPs`} (${ips.length})</div>
        <table class=u2-table>
            <tbody>${ips.map((row) => html`<tr>
              <td style="color:${uniqueColor(row.ip)}">${link(logUrl({ search: row.ip ?? "" }), row.ip ?? "-")}${myIpBadge(row.ip, myIp)}
              <td style="text-align:right">${row.n}
              <td style="white-space:nowrap; color:${ageColor(row.last)}">${u2.el.time(row.last, { narrow: true })}`)}
        </table>
    </div>

    <div class=u2-card style="flex:1 1 30rem">
        <div class=-head>${t`Sessions`}</div>
        <table class=u2-table>
            <tbody>${sessions.length ? sessions.map((row) => html`<tr>
              <td style="color:${uniqueColor(row.sess_id)}">${link(logUrl({ search: row.sess_id }), row.sess_id)}${Number(row.access) >= now - ACTIVE ? html` <small class=u2-badge>${activeLabel}</small>` : ""}
              <td>${row.usr_id ? user(row) : ""}
              <td style="text-align:right">${row.n}
              <td style="white-space:nowrap; color:${ageColor(row.first)}">${u2.el.time(row.first, { narrow: true })}`) : empty(4)}
        </table>
    </div>

    <div class=u2-card style="flex:1 1 40rem">
        <div class=-head>${t`User agents`} (${agents.length})</div>
        <table class=u2-table>
            <tbody>${agents.map((row) => {
              const ua = backend.uaInfo(row.user_agent ?? "");
              return html`<tr>
              <td><span style="color:${uniqueColor(ua.browser)}">${ua.browser} ${ua.version}</span> <small>${ua.os}</small><br><small style="word-break:break-all">${row.user_agent}</small>
              <td style="text-align:right">${row.n}
              <td style="white-space:nowrap"><span style="color:${ageColor(row.first)}">${u2.el.time(row.first, { narrow: true })}</span> – <span style="color:${ageColor(row.last)}">${u2.el.time(row.last, { narrow: true })}</span>`;
            })}
        </table>
    </div>

    ${withErrors ? html.async`<div class=u2-card style="flex:1 1 40rem">
        <div class=-head>${t`Errors`} (${errors.length})</div>
        <table class=u2-table>
            <tbody>${errors.length ? errors.map((row) => html`<tr>
              <td style="white-space:nowrap">${link(errorUrl({ id: row.id }), row.time)}
              <td>${row.source}
              <td style="word-break:break-all">${row.message}`) : empty(3)}
        </table>
    </div>` : ""}
</div>`;
}

// newest other clients with more than one request
export async function backendDashboardWidget(app: App, page?: Node): Promise<HtmlString> {
  const rows = await latest(app, 35, { window: 10000, returning: true, exclude: Number(getCtx().clientId) });
  const myIp = await app.t`my IP`;
  if (!rows.length || !page) return html``;
  const pageUrl = await page.url();
  const href = (client: unknown) => backend.toUrl(pageUrl, { id: client });
  return html`<div style="overflow:auto; padding:0"><table class=u2-table>${rows.map((row) => {
    const info = backend.uaInfo(row.user_agent ?? "");
    return html`<tr u2-href>
    <td><a href="${href(row.client_id)}" style="color:${uniqueColor(row.client_id)}">${row.client_id}</a>
    <td style="white-space:nowrap">${info.bot ? "bot" : html`<span style="color:${uniqueColor(info.browser)}">${info.browser}</span>`} ${row.usr_id ? html`<small style="color:${uniqueColor(row.usr_id)}">${userName(row)}</small>` : ""}
    <td style="white-space:nowrap"><small style="color:${uniqueColor(row.ip)}">${row.ip}</small>${myIpBadge(row.ip, myIp)}
    <td style="text-align:right">${row.requests}
    <td style="white-space:nowrap; color:${ageColor(row.time)}">${u2.el.time(row.time, { narrow: true })}`;
  })}</table></div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    parts: { list },
  },
};
