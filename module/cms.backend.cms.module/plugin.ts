import { html, getCtx, sql, type App, type HtmlString } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import { ADMIN, WRITE, describeChange, type Node } from "../cms/mod.ts";

export const name = "cms.backend.cms.module";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }) {
  await backend.install(app, name, { en: "Modules", de: "Module" });
}

/** Short type badge from the module name. */
const modType = (n: string) => n.match(/^cms\.(cont|layout|backend)\b/)?.[1] ?? "";

/** Module axis of the current user (3 without cms.accessRules). */
const modAccess = (app: App, module: string) =>
  app.fire("module:access", { module, user: getCtx().user, access: ADMIN }).then((e) => Number(e.access));

/** A module that can render a node — those are the ones listed here. */
const isContent = (app: App, module: string) => !!app.modules.get(module)?.plugin.cms?.node?.render;
const contentModules = (app: App) => Object.keys(app.modules.all()).sort().filter((n) => isContent(app, n));

/** Detail link of a module list page (this one or cms.backend.module). */
const modUrl = (base: string, module: string) => base + (base.includes("?") ? "&" : "?") + "mod=" + module;

const word = (list: string[]) => (v: unknown) => v == null ? "–" : list[Number(v)] ?? "?";
const accessWord = word(["none", "read", "edit", "admin"]);
// module.cms_access: null = no rule, 0 = off for everyone, 1-3 = default level (see cms/ACCESS.md)
const stdWord = word(["deny", "read", "edit", "insertable"]);

const time = (unix: unknown) => {
  if (!unix) return "";
  const iso = new Date(Number(unix) * 1000).toISOString();
  return html`<u2-time datetime="${iso}" type=relative>${iso.slice(0, 16).replace("T", " ")}</u2-time>`;
};

export const ctxSettingsSchema = {
  properties: { 
    filter: { properties: {
      type: { type: "string", description: "Selected type filter of the module overview."
    }} 
  }},
};

/** Usage count and last change per module — the latter via page.log_id_ch, the log row of a node's last change. */
const moduleStats = (app: App) => app.db.query`
  SELECT m.name, m.cms_access,
    (SELECT COUNT(*) FROM page WHERE module = m.name) AS used,
    (SELECT MAX(l.time) FROM page p JOIN log l ON l.id = p.log_id_ch WHERE p.module = m.name) AS changed
  FROM module m`;

async function renderOverview(node: Node): Promise<HtmlString> {
  const app = node.app, t = app.t, ctx = getCtx();
  const u = ctx.req.url.toURL();

  const mods = new Map((await moduleStats(app)).map((r) => [String(r.name), r]));

    console.log(getCtx().settings[name].filter.type());

  const selType = ctx.settings[name].filter.type() ?? "";
  const types = new Set<string>();
  const trs: HtmlString[] = [];
  let total = 0;
  for (const modName of contentModules(app)) {
    const row = mods.get(modName);
    if (!row) continue;
    total++;
    const type = modType(modName);
    types.add(type);
    u.searchParams.set("mod", modName);
    const dir = app.modules.get(modName)?.dir;
    const icon = dir && await Deno.stat(dir + "pub/module.svg").then(() => true, () => false);
    trs.push(html`<tr data-type="${type}" u2-href>
      <td style="padding-right:0">${icon ? html`<svg style="display:block" width=16 height=16><use href="${ctx.req.modulePath + modName}/pub/module.svg#main"/></svg>` : ""}
      <td><a href="${u.search}">${modName}</a>
      <td>${type}
      <td style="text-align:right" data-value="${row.used}">${Number(row.used) || ""}
      <td>${stdWord(row.cms_access)}
      <td data-value="${row.changed ?? 0}">${time(row.changed)}`);
  }

  return html.async`
<div class="u2-card -main" style="max-height:90vh; overflow:auto; flex-grow:0">
  <div class=-head>${t`Node render modules`}</div>
  <div class=-body>
    <input type=search data-search placeholder="${t`Search`}…" autofocus>
    <label>${t`Type`}
      <select data-type-filter>
        <option value="">${t`all`}
        ${html.join([...types].sort().map((ty) => html`<option value="${ty}" ${ty === selType ? html.raw("selected") : ""}>${ty || "–"}`))}
      </select>
    </label>
  </div>
  <u2-table style="padding:0">
    <table class="u2-table -Sticky">
      <thead><tr>
        <th width=10>
        <th data-sort-handler>${t`Module`}
        <th data-sort-handler>${t`Type`}
        <th data-sort-handler>${t`Used`}
        <th data-sort-handler title="${t`Default access for everyone`}">${t`Standard`}
        <th data-sort-handler>${t`Last change`}
      <tbody>${html.join(trs)}
      <tfoot><tr>
        <td colspan=6>${t`Total`}: ${total}
    </table>
  </u2-table>
</div>`;
}

/** Move nodes to another module — module axis on the target, edit access on every node. */
async function replace(node: Node, vars: Record<string, unknown>): Promise<string> {
  const app = node.app, t = app.t;
  const target = String(vars.replace ?? "");
  const ids = String(vars.ids ?? "").split(",").map(Number).filter(Boolean);
  if (!target || !ids.length) return "";
  if (!isContent(app, target)) return String(await t`Unknown module`);
  if (await modAccess(app, target) < ADMIN) return String(await t`No access to this module`);

  let done = 0, skipped = 0;
  for (const id of ids) {
    const n = (await node.cms.node(id)).exists();
    if (!n) continue;
    if (await n.access() < WRITE) { skipped++; continue; }
    await n.set("module", target);
    done++;
  }
  return `${await t`Changed`}: ${done}${skipped ? ` · ${await t`skipped`}: ${skipped}` : ""}`;
}

// Change history of the given nodes — same source as cms.backend.cms.history,
// narrowed to this module's nodes. One row per request and node.
async function historyRows(node: Node, ids: number[], titles: Map<number, string>): Promise<HtmlString[]> {
  if (!ids.length) return [];
  const t = node.app.t;
  const rows = await node.app.db.query`
    SELECT nc.log_id, nc.node_id, nc.data, l.time, u.email, u.firstname, u.lastname
      FROM node_changed nc
      JOIN log l ON l.id = nc.log_id
      LEFT JOIN sess s ON l.sess_id = s.id
      LEFT JOIN usr u  ON s.usr_id  = u.id
     WHERE nc.node_id IN (${sql.join(ids.map((id) => sql`${id}`), ",")})
     ORDER BY nc.id DESC LIMIT 200`.catch(() => []);

  const events = new Map<string, { row: Record<string, unknown>; labels: Set<string> }>();
  for (const r of rows) {
    const key = `${r.log_id}:${r.node_id}`;
    if (!events.has(key) && events.size >= 60) break;
    const ev = events.get(key) ?? { row: r, labels: new Set<string>() };
    events.set(key, ev);
    ev.labels.add(await describeChange(r.data, t)); // already HTML-escaped
  }

  const guest = await t`guest`;
  const out: HtmlString[] = [];
  for (const { row: r, labels } of events.values()) {
    const who = r.email ? (`${r.firstname ?? ""} ${r.lastname ?? ""}`.trim() || r.email) : guest;
    out.push(html`<tr>
      <td data-value="${r.time}">${time(r.time)}
      <td>${who}
      <td class=-where>${await backend.breadcrumb(node, Number(r.node_id), titles)}
      <td>${html.join([...labels].map((l) => html`<div>${html.raw(l)}</div>`))}`);
  }
  return out;
}

async function renderDetail(node: Node, modName: string, message: string): Promise<HtmlString> {
  const app = node.app, t = app.t;
  const ctx = getCtx();
  const back = ctx.req.url.toURL();
  back.searchParams.delete("mod");

  if (!isContent(app, modName)) {
    return html.async`<div class=u2-card>
      <div class=-head><a href="${back.search}">← ${t`Modules`}</a></div>
      <div class=-body>${t`Module`} ${modName} ${t`not found.`}</div>
    </div>`;
  }

  const access = await modAccess(app, modName);
  const standard = await app.db.one`SELECT cms_access FROM module WHERE name = ${modName}`;

  const limit = 500;
  const rows = await app.db.query`
    SELECT id, type FROM page WHERE module = ${modName} ORDER BY type DESC, id DESC LIMIT ${limit}`;
  const usedTotal = rows.length < limit ? rows.length
    : Number(await app.db.one`SELECT COUNT(*) FROM page WHERE module = ${modName}`);

  const [lCont, lPage] = await Promise.all([t`content`, t`page`]); // plain html`` does not await
  const titles = new Map<number, string>(); // ancestors are shared across breadcrumbs → cache
  const trs: HtmlString[] = [];
  const visible: number[] = [];
  let editable = 0;
  for (const row of rows) {
    const n = (await node.cms.node(Number(row.id))).exists();
    if (!n) continue;
    const nodeAccess = await n.access();
    if (nodeAccess < 1) continue;
    visible.push(n.id);
    if (nodeAccess >= WRITE) editable++;
    trs.push(html`<tr>
      <td>${nodeAccess >= WRITE ? html`<input type=checkbox data-check value="${n.id}">` : ""}
      <td><a href="${await n.url()}">${n.id}</a>
      <td>${row.type === "c" ? lCont : lPage}
      <td class=-where>${await backend.breadcrumb(node, n.id, titles)}
      <td>${accessWord(nodeAccess)}`);
  }

  // Only modules the user may assign (module axis = admin) are swap targets.
  const targets: string[] = [];
  for (const m of contentModules(app)) {
    if (m === modName) continue;
    if (await modAccess(app, m) < ADMIN) continue;
    targets.push(m);
  }

  const canReplace = access >= ADMIN && editable > 0 && targets.length > 0;
  // the code/plugin view of the same module, if that backend page is installed and readable
  const codePage = await (await node.cms.nodeByModule("cms.backend.module"))?.page();
  const codeUrl = codePage && await codePage.access() ? await codePage.url() : "";
  const history = await historyRows(node, visible, titles);

  return html.async`<div class="u2-flex cmsBackendCmsModule" data-mod="${modName}">
  <div class=u2-card style="flex:0 0 auto">
    <div class=-head><a href="${back.search}">← ${t`Modules`}</a> ${modName}</div>
    <table class=u2-table>
      <tr><th>${t`Type`}<td>${modType(modName)}
      <tr><th>${t`Used`}<td>${usedTotal}
      <tr><th>${t`Module access`}<td>${accessWord(access)}
      <tr><th>${t`Standard`}<td>${stdWord(standard)}
      ${codeUrl ? html.async`<tr><th>${t`Code`}<td><a href="${modUrl(codeUrl, modName)}">cms.backend.module</a>` : ""}
    </table>
    ${message ? html`<div class=-body><strong>${message}</strong></div>` : ""}
  </div>

  <div class=u2-card style="flex:1 1 31.25rem; max-height:90vh; overflow:auto">
    <div class=-head>${t`Used by`}</div>
    ${canReplace ? html.async`<form onsubmit="return false">
      <label>${t`Replace with`}
        <select name=target data-target><option value="">–${html.join(targets.map((m) => html`<option value="${m}">${m}`))}</select>
      </label>
      <button type=button data-replace u2-disableif="!target" u2-confirm="${t`Move the checked nodes to the other module?`}">${t`Replace`}</button>
      <small>${t`only checked, editable nodes`}</small>
    </form>` : ""}
    <u2-table style="padding:0">
      <table class="u2-table -Sticky" style="white-space:nowrap">
        <thead><tr>
          <th><input type=checkbox data-check-all>
          <th data-sort-handler>${t`ID`}
          <th data-sort-handler>${t`Type`}
          <th data-sort-handler>${t`Where`}
          <th data-sort-handler>${t`Node access`}
        <tbody>${html.join(trs)}
      </table>
    </u2-table>
    ${usedTotal > rows.length ? html.async`<div class=-body><small>${t`showing the first`} ${rows.length}</small></div>` : ""}
  </div>

  ${history.length ? html.async`<div class=u2-card style="flex:1 1 31.25rem; max-height:90vh; overflow:auto">
    <div class=-head>${t`History`}</div>
    <u2-table style="padding:0">
      <table class="u2-table -Sticky">
        <thead><tr>
          <th data-sort-handler>${t`When`}
          <th data-sort-handler>${t`Who`}
          <th data-sort-handler>${t`Where`}
          <th>${t`What`}
        <tbody>${html.join(history)}
      </table>
    </u2-table>
  </div>` : ""}
</div>`;
}

async function render(node: Node, { vars = {} }: { vars?: Record<string, unknown> } = {}): Promise<HtmlString> {
  const ctx = getCtx();
  const message = vars.replace ? await replace(node, vars) : "";
  const modName = String(vars.mod ?? ctx.req.query.mod ?? "");
  if (modName) return renderDetail(node, modName, message);
  return renderOverview(node);
}

export async function backendDashboardWidget(app: App, page?: Node): Promise<HtmlString> {
  const t = app.t;
  const rows = (await moduleStats(app)).filter((r) => isContent(app, String(r.name)));
  const base = page ? await page.url() : "";
  const link = (r: Record<string, unknown>, extra: HtmlString | string) =>
    html`<div><a href="${modUrl(base, String(r.name))}">${r.name}</a> ${extra}</div>`;

  const top = [...rows].sort((a, b) => Number(b.used) - Number(a.used)).slice(0, 7);
  const recent = [...rows].filter((r) => r.changed).sort((a, b) => Number(b.changed) - Number(a.changed)).slice(0, 3);

  return html.async`<div class=-body>
    <b>${rows.length}</b> ${t`modules`}
    <br><br><small>${t`Most used`}</small>
    ${html.join(top.map((r) => link(r, html`<small>${r.used}</small>`)))}
    <br><small>${t`Recently changed`}</small>
    ${html.join(recent.map((r) => link(r, html`<small>${time(r.changed)}</small>`)))}
  </div>`;
}

export const cms = { node: { js: ["pub/main.js"], render } };
