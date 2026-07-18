import { html, type App, type HtmlString } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.backend.cms.module";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }) {
  await backend.install(app, name, { en: "Modules", de: "Module" });
}

/** Short type badge from the module name. */
const modType = (n: string) => n.match(/^cms\.(cont|layout|backend|frontend)\./)?.[1] ?? "";

async function render(node: Node, { vars = {} }: { vars?: Record<string, unknown> }): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const db = app.db;

  // inline edit: set a module's cms_access level
  if (vars.set_access !== undefined) {
    const level = Math.min(Math.max(0, Number(vars.access) || 0), 3);
    await db.table("module").update(String(vars.set_access), { cms_access: level });
  }

  const levels = [await t`disabled`, await t`read only`, await t`editors`, await t`admins`];

  const rows = await db.query`
    SELECT m.name, m.cms_access,
      (SELECT COUNT(*) FROM page WHERE module = m.name) AS used
    FROM module m ORDER BY m.name`;
  const byName = new Map(rows.map((r) => [String(r.name), r]));

  // only imported modules that render content (export cms.node.render)
  const trs: Array<HtmlString | Promise<HtmlString>> = [];
  let total = 0;
  for (const modName of Object.keys(app.modules.all()).sort()) {
    const mod = app.modules.get(modName)!;
    if (!mod.plugin.cms?.node?.render) continue;
    const row = byName.get(modName);
    if (!row) continue;
    total++;
    const def = mod.plugin.cms.access ?? 1;
    const opts = html.join(levels.map((label, i) =>
      html`<option value=${i} ${i === Number(row.cms_access) ? "selected" : ""}>${i} · ${label}`));
    trs.push(html.async`<tr>
      <td>${modName}
      <td>${modType(modName)}
      <td style="text-align:right">${Number(row.used) || ""}
      <td><select class=u2-unstyle data-access="${modName}">${opts}</select>
        ${def !== Number(row.cms_access) ? html.async`<small>(${t`default`}: ${def})</small>` : ""}`);
  }

  return html.async`
<div class="u2-card -main" style="max-height:90vh; overflow:auto; flex-grow:0">
  <table class="u2-table -Sticky">
    <thead><tr>
      <th>${t`Module`}
      <th>${t`Type`}
      <th>${t`Used`}
      <th>${t`Access`}
    <tbody>${html.join(await Promise.all(trs))}
    <tfoot><tr>
      <td colspan=4>${t`Total`}: ${total}
  </table>
</div>`;
}

export function backendDashboardWidget(app: App): Promise<HtmlString> {
  return html.async`<div class=-body>
    <b>${app.db.one`SELECT count(*) FROM module`}</b> ${app.t`modules`}<br>
    <small>${app.db.one`SELECT count(*) FROM module WHERE cms_access = 0`} ${app.t`disabled`}</small>
  </div>`;
}

export const cms = { node: { js: ["pub/main.js"], render } };
