import { html, type App, type HtmlString } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.backend.cms.module.access";
export const needs = ["cms.backend.cms.module", "cms.moduleAccess"];

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Access", de: "Zugriff" });
}

function level(v: unknown): string {
  if (v === "" || v == null) return "";
  return String(Math.min(Math.max(0, Number(v) || 0), 3));
}

async function save(app: App, vars: Record<string, unknown>): Promise<void> {
  if (vars.set_access === undefined) return;
  const module = String(vars.module ?? "");
  const grpId = Number(vars.grp) || 0;
  const access = level(vars.access);
  if (!module || !grpId) return;
  if (!await app.db.one`SELECT name FROM module WHERE name = ${module}`) return;
  if (!await app.db.one`SELECT id FROM grp WHERE id = ${grpId}`) return;

  const table = app.db.table("cms_module_access_grp");
  const id = { module, grp_id: grpId };
  if (access === "") await table.delete(id);
  else await table.ensure({ ...id, access: Number(access) });
}

function groups(app: App): Promise<Record<string, string | number>[]> {
  return app.db.query`SELECT id, name FROM grp WHERE cms_access ORDER BY name`;
}

async function render(node: Node, { vars = {} }: { vars?: Record<string, unknown> }): Promise<HtmlString> {
  const app = node.app;
  await save(app, vars);

  const groupRows = await groups(app);
  const caps = new Map<string, number>();
  const capRows = await app.db.query`SELECT module, grp_id, access FROM cms_module_access_grp`;
  for (const r of capRows) caps.set(`${r.module}:${r.grp_id}`, Number(r.access) || 0);

  const dbRows = await app.db.query`
    SELECT m.name, m.cms_access,
      (SELECT COUNT(*) FROM page WHERE module = m.name) AS used
    FROM module m ORDER BY m.name`;
  const dbByName = new Map(dbRows.map((r) => [String(r.name), r]));

  const head = html.join(groupRows.map((g) => html`<th title="${g.name}"><div>${g.name}</div>`));
  const trParts: HtmlString[] = [];
  let total = 0;
  for (const module of Object.keys(app.modules.all()).sort()) {
    const mod = app.modules.get(module)!;
    if (!mod.plugin.cms?.node?.render) continue;
    const row = dbByName.get(module);
    if (!row) continue;
    total++;

    const cells = html.join(groupRows.map((g) => {
      const key = `${module}:${g.id}`;
      const v = caps.has(key) ? String(caps.get(key)) : "";
      return html`<td class=-cell data-module="${module}" data-grp="${g.id}" v="${v}" title="${g.name}: ${v || "no cap"}">${v || "-"}`;
    }));
    trParts.push(html`<tr>
      <td>${module}
      <td style="text-align:right">${Number(row.cms_access) || 0}
      <td style="text-align:right">${Number(row.used) || ""}
      ${cells}`);
  }

  return html.async`<div class="u2-card" style="max-height:90vh; overflow:auto; flex-grow:0">
  <table class="u2-table -Sticky cmsModuleAccess" style="white-space:nowrap">
    <thead>
      <tr>
        <th>${app.t`Module`}
        <th title="${app.t`Default access`}">${app.t`Default`}
        <th>${app.t`Used`}
        ${head}
    <tbody>${html.join(trParts)}
    <tfoot><tr><td colspan="${3 + groupRows.length}">${app.t`Total`}: ${total}
  </table>
</div>`;
}

export function backendDashboardWidget(app: App): Promise<HtmlString> {
  return html.async`<div class=-body>
    <b>${app.db.one`SELECT count(*) FROM cms_module_access_grp`}</b> ${app.t`module group rules`}<br>
    <small>${app.db.one`SELECT count(*) FROM cms_module_access_grp WHERE access = 0`} ${app.t`deny rules`}</small>
  </div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
  },
};
