import { hee, getCtx, type App, type RequestContext } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.backend.cms.module";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }) {
  await backend.install(app, name, { en: "Modules", de: "Module" });
}

/** Short type badge from the module name. */
const modType = (n: string) => n.match(/^cms\.(cont|layout|backend|frontend)\./)?.[1] ?? "";

async function render(node: Node, { ctx, vars = {} }: { ctx?: RequestContext; vars?: Record<string, unknown> } = {}): Promise<string> {
  ctx ??= getCtx();
  const app = node.app;
  const db = app.db;

  // inline edit: set a module's cms_access level
  if (vars.set_access !== undefined) {
    const level = Math.min(Math.max(0, Number(vars.access) || 0), 3);
    await db.query`UPDATE module SET cms_access = ${level} WHERE name = ${String(vars.set_access)}`;
  }

  const levels = [await app.t`disabled`, await app.t`read only`, await app.t`editors`, await app.t`admins`];

  const rows = await db.query`
    SELECT m.name, m.cms_access,
      (SELECT COUNT(*) FROM page WHERE module = m.name) AS used
    FROM module m ORDER BY m.name`;
  const byName = new Map(rows.map((r) => [String(r.name), r]));

  // only imported modules that render content (export cms.node.render)
  let trs = "", total = 0;
  for (const modName of Object.keys(app.modules.all()).sort()) {
    const mod = app.modules.get(modName)!;
    if (!mod.plugin.cms?.node?.render) continue;
    const row = byName.get(modName);
    if (!row) continue;
    total++;
    const def = mod.plugin.cms.access ?? 1;
    const opts = levels.map((label, i) =>
      `<option value=${i} ${i === Number(row.cms_access) ? "selected" : ""}>${i} · ${label}`).join("");
    trs += `<tr>
      <td>${hee(modName)}
      <td>${modType(modName)}
      <td style="text-align:right">${Number(row.used) || ""}
      <td><select class=u2-unstyle data-access="${hee(modName)}">${opts}</select>
        ${def !== Number(row.cms_access) ? `<small>(${await app.t`default`}: ${def})</small>` : ""}`;
  }

  return `
<div class="u2-card -main" style="max-height:90vh; overflow:auto; flex-grow:0">
  <table class="u2-table -Sticky">
    <thead><tr>
      <th>${await app.t`Module`}
      <th>${await app.t`Type`}
      <th>${await app.t`Used`}
      <th>${await app.t`Access`}
    <tbody>${trs}
    <tfoot><tr>
      <td colspan=4>${await app.t`Total`}: ${total}
  </table>
</div>`;
}

export async function backendDashboardWidget(app: App): Promise<string> {
  const total = Number(await app.db.one`SELECT count(*) FROM module`);
  const disabled = Number(await app.db.one`SELECT count(*) FROM module WHERE cms_access = 0`);
  return `<div class=-body>
    <b>${total}</b> ${await app.t`modules`}<br>
    <small>${disabled} ${await app.t`disabled`}</small>
  </div>`;
}

export const cms = { node: { js: ["pub/main.js"], render } };
