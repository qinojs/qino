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

/** Top requests and external referers of the newest requests: one scan, counted here, urls resolved per IN list. */
async function recent(app: App) {
  const db = app.db;
  const ctx = getCtx();
  const rows = await db.query`
    SELECT url_id, referer_id FROM log
     WHERE client_id IS NULL OR client_id != ${ctx.clientId}
     ORDER BY id DESC LIMIT ${WINDOW}`.catch(() => []);
  const top = (col: string, n: number) => {
    const m = new Map<number, number>();
    for (const row of rows) if (row[col] != null) m.set(Number(row[col]), (m.get(Number(row[col])) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
  };
  const urls = top("url_id", TOP);
  const refs = top("referer_id", 200); // own-host referers are dropped below
  const ids = [...urls, ...refs].map(([id]) => id);
  const names = ids.length
    ? new Map((await db.query`SELECT id, url FROM log_url WHERE ${sql.in("id", ids)}`).map((r) => [Number(r.id), String(r.url ?? "")]))
    : new Map<number, string>();
  const named = (list: [number, number][]) => list.map(([id, n]) => [names.get(id) ?? "", n] as const);
  const ownHost = ctx.req.url.host;
  return {
    total: rows.length,
    urls: named(urls),
    referers: named(refs)
      .filter(([url]) => { try { return new URL(url).host !== ownHost; } catch { return false; } })
      .slice(0, TOP),
  };
}

function topTable(rows: (readonly [string, number])[], total: number, colored = false): HtmlString {
  return html`<div style="overflow:auto; padding:0"><table class=u2-table>${rows.map(([label, n]) => html`<tr>
    <td style="word-break:break-all${colored ? html.raw(`; color:${uniqueColor(label)}`) : ""}">${label}
    <td style="text-align:right">${int(n)}
    <td style="text-align:right"><small>${total ? Math.round(n / total * 100) : 0}%</small>`)}</table></div>`;
}

async function render(node: Node): Promise<HtmlString> {
  const { t } = node.app;
  const r = await recent(node.app);
  return html.async`<div class=u2-flex>
  ${renderDashboard(node)}
  <div class=u2-flex>
    <div class=u2-card style="flex:1 1 30rem">
        <div class=-head>${t`Top requests`} <small>(${t`last ${WINDOW} requests`})</small></div>
        ${topTable(r.urls, r.total)}
    </div>
    <div class=u2-card style="flex:1 1 30rem">
        <div class=-head>${t`Top external referers`}</div>
        ${topTable(r.referers, r.total, true)}
    </div>
  </div>
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
