import { html, hee, sql, type App, type Ctx, type HtmlString, type Sql } from "../core/mod.ts";
import { describeChange, WRITE, type Node } from "../cms/mod.ts";
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
// window in SQL; type and — crucially — per-page edit rights are applied in JS,
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

// One display event = all mutations of a single request on a single page.
interface Event { key: string; ncMax: number; row: Record<string, any>; datas: unknown[]; nodes: Set<number>; lang?: string }

function parseData(raw: unknown): { table: string; lang?: string } {
  try {
    const d = JSON.parse(String(raw ?? "{}"));
    return { table: String(d.table ?? ""), lang: d.lang ? String(d.lang) : undefined };
  } catch { return { table: "" }; }
}

// Deep link into the frontend page in edit mode, scrolled to the changed content
// (content elements carry id="cmspid<id>"). The caller already holds edit rights.
function editLink(ctx: Ctx, pageId: number, anchorNode: number | undefined, lang: string): string {
  const anchor = anchorNode ? "#cmspid" + anchorNode : "";
  return `${ctx.req.basePath}?cmspid=${pageId}&lang=${encodeURIComponent(lang)}&cms_editmode=1${anchor}`;
}

// ── list (filterable / incrementally reloadable part) ───────────────────────
async function list(node: Node, { ctx, vars = {} }: { ctx: Ctx; vars?: Record<string, unknown> }): Promise<HtmlString> {
  const app = node.app;
  const f = (vars.filter ?? {}) as Record<string, string>;
  const rows = await candidates(app, f, ctx);

  const typeTables = TYPE_TABLES[f.type ?? ""];
  const access: Record<number, number> = {}; // per page: computed once, reused
  const events = new Map<string, Event>();
  const order: string[] = [];
  const MAX = 150;

  for (const r of rows) {
    const pageId = Number(r.page_id);
    access[pageId] ??= await (await node.cms.node(pageId)).access();
    if (access[pageId] < WRITE) continue; // only pages the caller may edit (superuser: all)
    const d = parseData(r.data);
    if (typeTables && !typeTables.includes(d.table)) continue;
    const key = r.log_id + ":" + pageId;
    let ev = events.get(key);
    if (!ev) {
      if (order.length >= MAX) continue;
      ev = { key, ncMax: Number(r.id), row: r, datas: [], nodes: new Set() };
      events.set(key, ev);
      order.push(key);
    }
    ev.ncMax = Math.max(ev.ncMax, Number(r.id));
    ev.datas.push(r.data);
    if (Number(r.node_id) !== pageId) ev.nodes.add(Number(r.node_id)); // changed content within the page
    ev.lang ??= d.lang;
  }

  if (!order.length) return html.async`<tr class=-empty><td colspan=5>${app.t`No changes found.`}`;
  const titles = new Map<number, string>(); // ancestors are shared across breadcrumbs → cache
  return html.join(await Promise.all(order.map((k) => renderRow(node, events.get(k)!, titles, ctx))));
}

async function renderRow(node: Node, ev: Event, titles: Map<number, string>, ctx: Ctx): Promise<HtmlString> {
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

  // deep-link the page crumb into edit mode, anchored at the changed content
  // when the event touched exactly one node inside the page.
  const anchor = ev.nodes.size === 1 ? [...ev.nodes][0] : undefined;
  const href = editLink(ctx, Number(r.page_id), anchor, ev.lang || ctx.lang);

  return html.async`
<tr class=-row data-key="${ev.key}" data-nc="${ev.ncMax}">
  <td class=-when><u2-time datetime="${iso}" type=relative title="${stamp}">${stamp}</u2-time>
  <td class=-who>${await actorCell(r, t)}
  <td class=-where>${await breadcrumb(node, Number(r.page_id), titles, href, await t`Open in edit mode`)}
  <td class=-what>${html.join(labels)}
  <td class=-client>${r.ip ?? "-"}<br><small>${ua.label}${ua.bot ? html.raw(" <span class=u2-badge>bot</span>") : html.raw("")}</small>`;
}

async function actorCell(r: Record<string, any>, t: TFn): Promise<HtmlString> {
  if (!r.usr_id) return html`<small>${await t`guest`}</small>`;
  const name = `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim();
  return html.async`<b>${name || r.email}</b>${name && r.email ? html`<br><small>${r.email}</small>` : ""}`;
}

// Linked breadcrumb from the tree root down to the changed page. Titles are
// cached across rows so shared ancestors are looked up once per request.
async function breadcrumb(host: Node, pageId: number, titles: Map<number, string>): Promise<HtmlString> {
  const P = await host.cms.node(pageId);
  const nodes = [...(await P.path()).values()].filter((n) => n.id !== 1); // drop system root
  const crumbs: HtmlString[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const title = (await nodeTitle(n, titles)) || `#${n.id}`;
    let url = "";
    try { url = await n.url(); } catch { /* no url (e.g. detached) */ }
    const last = i === nodes.length - 1;
    crumbs.push(html`<a href="${url}" target=_blank${last ? html.raw(" class=-page") : html.raw("")}>${title}</a>`);
  }
  if (!crumbs.length) crumbs.push(html`<span class=-page>#${pageId}</span>`);
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
  <div class="-toolbar u2-card">
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
      <tbody class=-list cms-part=history>${initial}</tbody>
    </table>
  </div>
</div>`;
}

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
    parts: { history: list },
  },
};
