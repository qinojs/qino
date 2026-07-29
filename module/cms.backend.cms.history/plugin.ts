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



// Candidate node_changed rows (newest first). Search/date/own-client narrow the
// window in SQL; type and — crucially — per-node edit rights are applied in JS,
// because access is inheritance/group/event derived and not expressible in SQL.
function candidates(app: App, f: Record<string, string>, ctx: Ctx): Promise<Record<string, any>[]> {
  const db = app.db;
  const where: Sql[] = [sql.raw("1")];
  if (f.from)          where.push(sql`l.time >= ${backend.toUnix(f.from)}`);
  if (f.to)            where.push(sql`l.time <= ${backend.toUnix(f.to)}`);
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
  return db.query`
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
  const max = 150;

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
      if (order.length >= max) continue;
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
  const ua = backend.uaInfo(r.ua ?? "");

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
  <td class=-where>${await backend.breadcrumb(node, Number(r.node_id), titles)}
  <td class=-what>${html.join(labels)}
  <td class=-client>${r.ip ?? "-"}<br><small>${ua.browser} ${ua.version.split(".")[0]}${ua.bot ? html.raw(" <span class=u2-badge>bot</span>") : html.raw("")}</small>`;
}

async function actorCell(r: Record<string, any>, t: TFn): Promise<HtmlString> {
  if (!r.usr_id) return html`<small>${await t`guest`}</small>`;
  const name = `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim();
  return html.async`<b>${name || r.email}</b>${name && r.email ? html`<br><small>${r.email}</small>` : ""}`;
}

// ── render ──────────────────────────────────────────────────────────────────
async function render(node: Node, { ctx, vars = {} }: { ctx: Ctx; vars?: Record<string, unknown> }): Promise<HtmlString> {
  const t = node.app.t;
  const initial = await list(node, { ctx, vars: { filter: vars.filter ?? {} } });
  return html.async`
<div class=u2-flex>
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

  const items = [...latest.values()].sort((a, b) => b.time - a.time);
  const trs: HtmlString[] = [];
  for (const it of items) {
    const page = await cmsOf(app).node(it.pageId);
    const title = (await (await page.title()).string()).trim() || "#" + it.pageId;
    let url = "";
    try { url = await page.url(); } catch { /* no url */ }
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
