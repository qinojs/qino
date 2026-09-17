import { getCtx, html, sql, unixTime } from "@qino/qino";
import { backend, renderDashboard } from "@qino/qino/cms.backend";

import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;
const { uniqueColor } = backend;

// Everything here is either an indexed time range or the newest log rows (primary key range).
const WINDOW = 20000;
const TOP = 20;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Requests", de: "Anfragen" });
}

const int = (n: unknown) => (Number(n) || 0).toLocaleString("de-CH");
const count = (query: Promise<unknown>) => query.catch(() => 0);

/** Request, client and user counts over short, indexed time ranges. */
async function counts(app: App) {
  const db = app.db;
  const now = unixTime();
  const hour = now - 3600, day = now - 86400;
  const others = sql`(log.client_id IS NULL OR log.client_id != ${getCtx().clientId})`;
  const [lastHour, lastDay, clients, users, online] = await Promise.all([
    count(db.one`SELECT count(*) FROM log WHERE time >= ${hour} AND ${others}`),
    count(db.one`SELECT count(*) FROM log WHERE time >= ${day} AND ${others}`),
    count(db.one`SELECT count(DISTINCT client_id) FROM log WHERE time >= ${day} AND ${others}`),
    count(db.one`SELECT count(DISTINCT sess.usr_id) FROM log JOIN sess ON log.sess_id = sess.id WHERE log.time >= ${day} AND sess.usr_id IS NOT NULL AND ${others}`),
    count(db.one`SELECT count(*) FROM sess WHERE access >= ${now - 900}`),
  ]);
  return { lastHour, lastDay, clients, users, online };
}

/** Top values of the newest requests: one scan, aggregated here, names resolved per IN list. */
async function recent(app: App) {
  const db = app.db;
  const own = getCtx().clientId;
  const rows = await db.query`
    SELECT url_id, referer_id, user_agent_id FROM log
     WHERE client_id IS NULL OR client_id != ${own}
     ORDER BY id DESC LIMIT ${WINDOW}`.catch(() => []);
  const tally = (col: string) => {
    const m = new Map<number, number>();
    for (const row of rows) if (row[col] != null) m.set(Number(row[col]), (m.get(Number(row[col])) ?? 0) + 1);
    return m;
  };
  const top = (m: Map<number, number>, n = TOP) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
  const names = async (table: string, col: string, ids: number[]) => ids.length
    ? new Map((await db.query`SELECT id, ${sql.id(col)} AS v FROM ${sql.id(table)} WHERE ${sql.in("id", ids)}`).map((r) => [Number(r.id), String(r.v ?? "")]))
    : new Map<number, string>();

  const urls = tally("url_id"), referers = tally("referer_id"), agents = tally("user_agent_id");
  const topUrls = top(urls);
  const topReferers = top(referers, 200); // own-host referers are dropped below
  const [urlNames, refNames, uaNames] = await Promise.all([
    names("log_url", "url", topUrls.map(([id]) => id)),
    names("log_url", "url", topReferers.map(([id]) => id)),
    names("log_user_agent", "user_agent", [...agents.keys()]),
  ]);

  // browsers and bot share, by classifying each distinct user agent once
  const browsers = new Map<string, number>();
  let bots = 0;
  for (const [id, n] of agents) {
    const info = backend.uaInfo(uaNames.get(id) ?? "");
    if (info.bot) bots += n;
    else browsers.set(info.browser, (browsers.get(info.browser) ?? 0) + n);
  }

  const ownHost = getCtx().req.url.host;
  const foreign = topReferers
    .map(([id, n]) => [refNames.get(id) ?? "", n] as const)
    .filter(([url]) => { try { return new URL(url).host !== ownHost; } catch { return false; } })
    .slice(0, TOP);

  return {
    total: rows.length,
    bots,
    browsers: [...browsers].sort((a, b) => b[1] - a[1]).slice(0, TOP),
    urls: topUrls.map(([id, n]) => [urlNames.get(id) ?? "", n] as const),
    referers: foreign,
  };
}

function topTable(rows: readonly (readonly [string, number])[], total: number, colored = false): HtmlString {
  return html`<div style="overflow:auto; padding:0"><table class=u2-table>${rows.map(([label, n]) => html`<tr>
    <td style="word-break:break-all${colored ? html.raw(`; color:${uniqueColor(label)}`) : ""}">${label}
    <td style="text-align:right">${int(n)}
    <td style="text-align:right"><small>${total ? Math.round(n / total * 100) : 0}%</small>`)}</table></div>`;
}

async function render(node: Node): Promise<HtmlString> {
  const { app } = node;
  const { t } = app;
  const [c, r] = await Promise.all([counts(app), recent(app)]);
  const human = r.total - r.bots;
  return html.async`<div class=u2-flex>
  <div class=u2-flex>
    <div class=u2-card>
        <div class=-head>${t`Overview`}</div>
        <table class=u2-table>
            <tr><td>${t`Requests last hour`}<td style="text-align:right">${int(c.lastHour)}
            <tr><td>${t`Requests (24h)`}<td style="text-align:right">${int(c.lastDay)}
            <tr><td>${t`Clients (24h)`}<td style="text-align:right">${int(c.clients)}
            <tr><td>${t`Logged-in users (24h)`}<td style="text-align:right">${int(c.users)}
            <tr><td>${t`Active sessions (15 min)`}<td style="text-align:right">${int(c.online)}
            <tr><td>${t`Bots`} <small>(${t`last ${WINDOW} requests`})</small><td style="text-align:right">${r.total ? Math.round(r.bots / r.total * 100) : 0}%
        </table>
    </div>
    <div class=u2-card>
        <div class=-head>${t`Browsers`} <small>(${t`without bots`})</small></div>
        ${topTable(r.browsers, human, true)}
    </div>
    <div class=u2-card style="flex:1 1 30rem">
        <div class=-head>${t`Top requests`} <small>(${t`last ${WINDOW} requests`})</small></div>
        ${topTable(r.urls, r.total)}
    </div>
    <div class=u2-card style="flex:1 1 30rem">
        <div class=-head>${t`Top external referers`}</div>
        ${topTable(r.referers, r.total, true)}
    </div>
  </div>
  ${renderDashboard(node)}
</div>`;
}

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const c = await counts(app);
  return html.async`<div class=-body>
    <b>${int(c.lastDay)}</b> ${app.t`requests (24h)`} · ${int(c.lastHour)} ${app.t`last hour`}<br>
    <small>${int(c.clients)} ${app.t`clients`} · ${int(c.users)} ${app.t`logged-in users`} · ${int(c.online)} ${app.t`active sessions`}</small>
</div>`;
}

export const cms = {
  node: {
    render,
  },
};
