// deno-lint-ignore-file no-explicit-any -- db rows are dynamically shaped (as in the sibling cms modules)
import { html, sql, type App, type Ctx, type HtmlString, type Sql } from "../core/mod.ts";
import { cms as cmsOf, describeChange, WRITE, type Node } from "../cms/mod.ts";
import { backend } from "../cms.backend/mod.ts";

export const name = "cms.backend.cms.history";
export const needs = ["cms.backend", "cms"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "History", de: "Verlauf" });
}

type TFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<string>;

// change-type filter → the node_changed `data.table` values it covers.
const TYPE_TABLES: Record<string, string[]> = {
  page:   ["page"],
  text:   ["page_text", "text"],
  file:   ["page_file", "file"],
  access: ["page_access_grp", "page_access_usr"],
};

// from/to arrive as unix seconds (converted in the browser, where the TZ is known);
// fall back to parsing a raw datetime string for direct API calls.
const toUnix = (v: string): number => {
  if (/^\d+$/.test(v)) return Number(v);
  const ms = Date.parse(v);
  return isNaN(ms) ? 0 : Math.floor(ms / 1000);
};

// lightweight user-agent → "Browser 123" + bot flag
function uaInfo(ua: string): { label: string; bot: boolean } {
  const bot = /bot|crawl|spider|slurp|bing|google|yandex|baidu|duckduck|facebookexternal|headless|preview|monitor/i.test(ua);
  const tests: [string, RegExp][] = [
    ["Edge", /Edg(?:e|A|iOS)?\/([\d.]+)/],
    ["Opera", /(?:OPR|Opera)\/([\d.]+)/],
    ["Samsung", /SamsungBrowser\/([\d.]+)/],
    ["Firefox", /Firefox\/([\d.]+)/],
    ["Chrome", /Chrome\/([\d.]+)/],
    ["Safari", /Version\/([\d.]+).*Safari/],
  ];
  for (const [browser, re] of tests) {
    const m = re.exec(ua);
    if (m) return { label: `${browser} ${m[1].split(".")[0]}`, bot };
  }
  return { label: ua ? "?" : "-", bot };
}

// Candidate node_changed rows (newest first). Search/date/own-client narrow the
// window in SQL; type and — crucially — per-node edit rights are applied in JS,
// because access is inheritance/group/event derived and not expressible in SQL.
async function candidates(app: App, f: Record<string, string>, ctx: Ctx): Promise<Record<string, any>[]> {
  const db = app.db;
  const where: Sql[] = [sql.raw("1")];
  if (f.from)          where.push(sql`l.time >= ${toUnix(f.from)}`);
  if (f.to)            where.push(sql`l.time <= ${toUnix(f.to)}`);
  if (f.mine === "no") where.push(sql`l.client_id != ${ctx.clientId}`);
  if (f.sinceId)       where.push(sql`nc.id > ${Number(f.sinceId)}`);
  const s = (f.search ?? "").trim();
  if (s) {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s) || s.includes(":")) {
      where.push(sql`l.ip_id = (SELECT id FROM log_ip WHERE ip = ${s})`);
    } else {
      const like = "%" + s + "%";
      where.push(sql`(u.email LIKE ${like} OR u.firstname LIKE ${like} OR u.lastname LIKE ${like})`);
    }
  }
  return await db.query`
    SELECT nc.id, nc.log_id, nc.node_id, nc.page_id, nc.data,
           l.time, l.client_id, ip.ip AS ip, ua.user_agent AS ua,
           u.id AS usr_id, u.email, u.firstname, u.lastname
      FROM node_changed nc
      JOIN log l ON l.id = nc.log_id
      LEFT JOIN log_ip ip         ON l.ip_id         = ip.id
      LEFT JOIN log_user_agent ua ON l.user_agent_id = ua.id
      LEFT JOIN sess s            ON l.sess_id       = s.id
      LEFT JOIN usr u             ON s.usr_id        = u.id
     WHERE ${sql.join(where, " AND ")}
     ORDER BY nc.id DESC LIMIT 1200`.catch(() => []);
}

// One display event = all mutations of a single request on a single node.
interface Event { key: string; ncMax: number; row: Record<string, any>; datas: unknown[] }

// ── list (filterable / incrementally reloadable part) ───────────────────────
async function list(node: Node, { ctx, vars = {} }: { ctx: Ctx; vars?: Record<string, unknown> }): Promise<HtmlString> {
  const app = node.app;
  const f = (vars.filter ?? {}) as Record<string, string>;
  const rows = await candidates(app, f, ctx);

  const typeTables = TYPE_TABLES[f.type ?? ""];
  const events = new Map<string, Event>();
  const order: string[] = [];
  const MAX = 150;

  for (const r of rows) {
    const nodeId = Number(r.node_id);
    if (await (await node.cms.node(nodeId)).access() < WRITE) continue; // edit right on the changed node (superuser: all)
    if (typeTables) {
      let table = "";
      try { table = JSON.parse(String(r.data ?? "{}")).table; } catch { /* ignore */ }
      if (!typeTables.includes(table)) continue;
    }
    const key = r.log_id + ":" + nodeId; // one event per request × changed node
    let ev = events.get(key);
    if (!ev) {
      if (order.length >= MAX) continue;
      ev = { key, ncMax: Number(r.id), row: r, datas: [] };
      events.set(key, ev);
      order.push(key);
    }
    ev.ncMax = Math.max(ev.ncMax, Number(r.id));
    ev.datas.push(r.data);
  }

  if (!order.length) return html.async`<tr class=-empty><td colspan=5>${app.t`No changes found.`}`;
  const titles = new Map<number, string>(); // ancestors are shared across breadcrumbs → cache
  return html.join(await Promise.all(order.map((k) => renderRow(node, events.get(k)!, titles))));
}

async function renderRow(node: Node, ev: Event, titles: Map<number, string>): Promise<HtmlString> {
  const t = node.app.t;
  const r = ev.row;
  const iso = new Date(Number(r.time) * 1000).toISOString();
  const stamp = iso.slice(0, 16).replace("T", " ");
  const ua = uaInfo(r.ua ?? "");

  const seen = new Set<string>();
  const labels: HtmlString[] = [];
  for (const d of ev.datas) {
    const label = await describeChange(d, t); // already HTML-escaped
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(html`<div class=-change>${html.raw(label)}</div>`);
  }

  return html.async`
<tr class=-row data-key="${ev.key}" data-nc="${ev.ncMax}">
  <td class=-when><u2-time datetime="${iso}" type=relative title="${stamp}">${stamp}</u2-time>
  <td class=-who>${await actorCell(r, t)}
  <td class=-where>${await breadcrumb(node, Number(r.node_id), titles)}
  <td class=-what>${html.join(labels)}
  <td class=-client>${r.ip ?? "-"}<br><small>${ua.label}${ua.bot ? html.raw(" <span class=u2-badge>bot</span>") : html.raw("")}</small>`;
}

async function actorCell(r: Record<string, any>, t: TFn): Promise<HtmlString> {
  if (!r.usr_id) return html`<small>${await t`guest`}</small>`;
  const name = `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim();
  return html.async`<b>${name || r.email}</b>${name && r.email ? html`<br><small>${r.email}</small>` : ""}`;
}

// Linked breadcrumb from the tree root down to the changed node (a page or a
// content within it). Titles are cached across rows so shared ancestors are
// looked up once per request; content nodes usually have no title, so fall back
// to their (shortened) module name, then the id.
async function breadcrumb(host: Node, nodeId: number, titles: Map<number, string>): Promise<HtmlString> {
  const N = await host.cms.node(nodeId);
  const nodes = [...(await N.path()).values()].filter((n) => n.id !== 1); // drop system root
  // the containing page is the deepest type='p' node; contents hang below it → show it in bold
  let pageIdx = -1;
  for (let i = 0; i < nodes.length; i++) if (nodes[i].vs?.type === "p") pageIdx = i;
  const crumbs: HtmlString[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const title = (await nodeTitle(n, titles)) || String(n.vs?.module ?? "").replace(/^cms\.\w+\./, "") || `#${n.id}`;
    let url = "";
    try { url = await n.url(); } catch { /* no url (e.g. detached) */ }
    crumbs.push(html`<a href="${url}" target=_blank>${i === pageIdx ? html`<b>${title}</b>` : title}</a>`);
  }
  if (!crumbs.length) crumbs.push(html`<span>#${nodeId}</span>`);
  return html.join(crumbs, ' <span class="-sep">›</span> ');
}

async function nodeTitle(n: Node, cache: Map<number, string>): Promise<string> {
  const hit = cache.get(n.id);
  if (hit !== undefined) return hit;
  const s = ((await (await n.title())?.string?.()) ?? "").trim();
  cache.set(n.id, s);
  return s;
}

// ── render ──────────────────────────────────────────────────────────────────
async function render(node: Node, { ctx, vars = {} }: { ctx: Ctx; vars?: Record<string, unknown> }): Promise<HtmlString> {
  const t = node.app.t;
  const initial = await list(node, { ctx, vars: { filter: (vars.filter ?? {}) as Record<string, string> } });
  return html.async`
<div class="-m-history u2-flex">
  <div class=u2-card>
    <div class=-body>
      <form class=-filter>
        <label>${t`Search`}<br><input name=search placeholder="${t`User or IP`}"></label>
        <label>${t`Type`}<br><select name=type>
          <option value="">${t`All changes`}
          <option value=page>${t`Page / structure`}
          <option value=text>${t`Text`}
          <option value=file>${t`Files`}
          <option value=access>${t`Access`}
        </select></label>
        <label>${t`from`}<br><input type=datetime-local name=from></label>
        <label>${t`to`}<br><input type=datetime-local name=to></label>
        <label class=-check><input type=checkbox name=mine value=no> ${t`Hide my own`}</label>
        <span class=-status aria-live=polite></span>
      </form>
    </div>
  </div>

  <div class="-scroll u2-card">
    <table class=u2-table>
      <thead><tr>
        <th>${t`When`}
        <th>${t`Who`}
        <th>${t`Where`}
        <th>${t`What`}
        <th>${t`Client`}
      <tbody cms-part=history>${initial}</tbody>
    </table>
  </div>
</div>`;
}

// Dashboard widget: most recently active editors — one row per user with their
// latest change (time + page). Access-filtered like the list, so a viewer only
// sees activity on pages they may edit (superuser: all).
export async function backendDashboardWidget(app: App): Promise<string> {
  const t = app.t;
  const rows = await app.db.query`
    SELECT nc.id, nc.node_id, nc.page_id, l.time, u.id AS usr_id, u.email, u.firstname, u.lastname
      FROM node_changed nc
      JOIN log l ON l.id = nc.log_id
      LEFT JOIN sess s ON l.sess_id = s.id
      LEFT JOIN usr u  ON s.usr_id  = u.id
     ORDER BY nc.id DESC LIMIT 600`.catch(() => []);

  const latest = new Map<string, { time: number; name: string; pageId: number }>();
  for (const r of rows) {
    if (await (await cmsOf(app).node(Number(r.node_id))).access() < WRITE) continue;
    const uid = r.usr_id ? "u" + r.usr_id : "guest";
    if (latest.has(uid)) continue; // rows are newest-first → first hit is this user's latest
    const name = r.usr_id ? (`${r.firstname ?? ""} ${r.lastname ?? ""}`.trim() || r.email || "#" + r.usr_id) : await t`guest`;
    latest.set(uid, { time: Number(r.time), name, pageId: Number(r.page_id) });
    if (latest.size >= 12) break;
  }
  if (!latest.size) return "";

  const titles = new Map<number, string>();
  const items = [...latest.values()].sort((a, b) => b.time - a.time);
  const trs: HtmlString[] = [];
  for (const it of items) {
    const P = await cmsOf(app).node(it.pageId);
    const title = (await nodeTitle(P, titles)) || "#" + it.pageId;
    let url = "";
    try { url = await P.url(); } catch { /* no url */ }
    const iso = new Date(it.time * 1000).toISOString();
    trs.push(html`<tr>
      <td>${it.name}
      <td style="white-space:nowrap"><u2-time datetime="${iso}" type=relative></u2-time>
      <td><a href="${url}" target=_blank>${title}</a>`);
  }
  return String(await html.async`<div class=-body style="padding:0">
    <table class=u2-table style="vertical-align:top">${html.join(trs)}</table>
  </div>`);
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
    parts: { history: list },
  },
};
