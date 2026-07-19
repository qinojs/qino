import { html, type App, type HtmlString } from "../core/mod.ts";
import { backend } from "../cms.backend/mod.ts";
import { invalidateStandards } from "../cms.accessRules/mod.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.backend.cms.accessRules";
export const needs = ["cms.backend", "cms.accessRules"];

export const settingsSchema = { properties: { canCreateGroups: { type: "boolean", default: true } } };

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Access rules", de: "Zugriffsregeln" });
  const s = app.settings[name];
  for (const [key, meta] of Object.entries(settingsSchema.properties)) {
    if ((await s[key]) == null) await s[key](meta.default);
  }
}

const clamp = (v: unknown, min = 0) => Math.min(Math.max(min, Number(v) || 0), 3);
const level = (v: unknown) => (v === "" || v == null ? "" : String(clamp(v)));

/** One handler for every edit: override cell, CAP row, module ceiling, bulk (ceiling/override), add group. */
async function save(app: App, vars: Record<string, unknown>): Promise<void> {
  const setOverride = async (module: string, grpId: number, access: string) => {
    const table = app.db.table("cms_module_access_grp"), id = { module, grp_id: grpId };
    if (access === "") await table.delete(id);
    else await table.ensure({ ...id, access: Number(access) });
  };

  if (vars.set_access !== undefined) { // single override cell
    const module = String(vars.module ?? ""), grpId = Number(vars.grp) || 0;
    if (module && grpId) await setOverride(module, grpId, level(vars.access));
  } else if (vars.set_cap !== undefined) { // grp.cms_access
    const grpId = Number(vars.grp) || 0;
    if (grpId) await app.db.table("grp").update(grpId, { cms_access: clamp(vars.access, 1) });
  } else if (vars.set_ceiling !== undefined) { // module.cms_access
    const module = String(vars.module ?? ""), access = level(vars.access);
    if (module) await app.db.table("module").update(module, { cms_access: access === "" ? null : Number(access) });
    invalidateStandards(app);
  } else if (vars.bulk_ceiling !== undefined) { // set standard of many modules
    const access = level(vars.access), val = access === "" ? null : Number(access);
    for (const m of String(vars.modules ?? "").split(",").filter(Boolean)) {
      await app.db.table("module").update(m, { cms_access: val });
    }
    invalidateStandards(app);
  } else if (vars.bulk_override !== undefined) { // set one group's override for many modules
    const grpId = Number(vars.grp) || 0, access = level(vars.access);
    if (grpId) for (const m of String(vars.modules ?? "").split(",").filter(Boolean)) await setOverride(m, grpId, access);
  } else if (vars.add_group !== undefined) { // promote/create a group into the matrix
    let grpId = Number(vars.grp) || 0;
    if (!grpId && vars.new_group && await app.settings[name].canCreateGroups) {
      grpId = Number(await app.db.table("grp").insert({ name: String(vars.new_group).trim() }));
    }
    if (grpId) await app.db.table("grp").update(grpId, { cms_access: clamp(vars.cap, 1) });
  }
}

async function render(node: Node, { vars = {} }: { vars?: Record<string, unknown> }): Promise<HtmlString> {
  const app = node.app, t = app.t;
  await save(app, vars);

  const groupRows = await app.db.query`SELECT id, name, cms_access FROM grp WHERE cms_access ORDER BY name`;
  const overrides = new Map<string, number>();
  for (const r of await app.db.query`SELECT module, grp_id, access FROM cms_module_access_grp`)
    overrides.set(`${r.module}:${r.grp_id}`, Number(r.access) || 0);
  const modRows = new Map((await app.db.query`
    SELECT m.name, m.cms_access, (SELECT COUNT(*) FROM page WHERE module = m.name) AS used FROM module m`)
    .map((r) => [String(r.name), r]));

  // labels (plain html`` doesn't await app.t) + value→word map for the coloured cells
  const [lGroup, lName, lNew, lCap, lRead, lEdit, lAdmin, lAdd, lSearch, lSet, lNone, lDeny, lSave, lStd] = await Promise.all(
    [t`Group`, t`Name`, t`new group`, t`Cap`, t`read`, t`edit`, t`insertable`, t`add`, t`Search`, t`Set checked`, t`— none —`, t`deny`, t`save`, t`standard`]);
  const word: Record<string, string> = { "": "–", "0": lDeny, "1": lRead, "2": lEdit, "3": lAdmin };

  const head = html.join(groupRows.map((g) => html`<th data-sort-handler title="${g.name}"><div>${g.name}</div>`));
  const capCells = html.join(groupRows.map((g) =>
    html`<td class=-cell data-kind=cap data-grp="${g.id}" v="${g.cms_access}">${word[String(g.cms_access)]}`));

  const trParts: HtmlString[] = [];
  let total = 0;
  for (const module of Object.keys(app.modules.all()).sort()) {
    if (!app.modules.get(module)!.plugin.cms?.node?.render) continue;
    const row = modRows.get(module);
    if (!row) continue;
    total++;
    const ceil = row.cms_access == null ? "" : String(row.cms_access);
    const cells = html.join(groupRows.map((g) => {
      const v = overrides.has(`${module}:${g.id}`) ? String(overrides.get(`${module}:${g.id}`)) : "";
      return html`<td class=-cell data-kind=override data-module="${module}" data-grp="${g.id}" v="${v}">${word[v]}`;
    }));
    trParts.push(html`<tr data-name="${module}">
      <td><input type=checkbox data-check>
      <td>${module}
      <td style="text-align:right">${Number(row.used) || ""}
      <td class=-cell data-kind=ceiling data-module="${module}" v="${ceil}">${word[ceil]}
      ${cells}`);
  }

  const canCreate = await app.settings[name].canCreateGroups;
  const other = await app.db.query`SELECT id, name FROM grp WHERE cms_access IS NULL OR cms_access = 0 ORDER BY name`;
  const bulkCols = html.join(groupRows.map((g) => html`<option value="${g.id}">${g.name}`));

  return html.async`<div class="u2-flex cmsAccessRules" data-labels="${JSON.stringify(word)}">
  <div class="u2-card -matrix" style="flex:1 1 700px; max-height:90vh; overflow:auto">
    <div class=-head>${t`Access rules`}</div>
    <div class="-body -toolbar">
      <div>
        <input type=search data-search placeholder="${lSearch}…">
        <label>${lSet}:
          <select data-bulk><option value="">${lNone}<option value=0>${lDeny}<option value=1>${lRead}<option value=2>${lEdit}<option value=3>${lAdmin}</select>
          <select data-bulk-col><option value=standard>${lStd}${bulkCols}</select>
          <button data-bulk-apply type=button>${lSave}</button>
        </label>
      </div>
      <span class=-legend>
        <span><i class=-a1></i>${lRead}</span><span><i class=-a2></i>${lEdit}</span><span><i class=-a3></i>${lAdmin}</span>
      </span>
    </div>
    <u2-table style="padding:0">
      <table class="u2-table -Sticky" style="white-space:nowrap">
        <thead>
          <tr>
            <th><input type=checkbox data-check-all>
            <th data-sort-handler>${t`Module`}
            <th data-sort-handler>${t`Used`}
            <th data-sort-handler title="${t`Module ceiling`}">${lStd}
            ${head}
          <tr class=-cap>
            <td>
            <td><b>CAP</b>
            <td>–
            <td>–
            ${capCells}
        <tbody>${html.join(trParts)}
        <tfoot><tr><td colspan="${4 + groupRows.length}">${t`Total`}: ${total}
      </table>
    </u2-table>
  </div>

  <div class="u2-card -add" style="flex:0 0 auto">
    <div class=-head>${t`Add group`}</div>
    <form class=-add-group>
      <label>${lGroup}<br><select name=grp>
        ${canCreate ? html`<option value="">— ${lNew} —` : ""}
        ${html.join(other.map((g) => html`<option value="${g.id}">${g.name}`))}
      </select></label>
      ${canCreate ? html`<label>${lName}<br><input name=new_group></label>` : ""}
      <label>${lCap}<br><select name=cap>
        <option value=1>${lRead}<option value=2>${lEdit}<option value=3>${lAdmin}
      </select></label>
      <button>${lAdd}</button>
    </form>
  </div>
</div>`;
}

export function backendDashboardWidget(app: App): Promise<HtmlString> {
  return html.async`<div class=-body>
    <b>${app.db.one`SELECT count(*) FROM cms_module_access_grp`}</b> ${app.t`module group rules`}<br>
    <small>${app.db.one`SELECT count(*) FROM grp WHERE cms_access`} ${app.t`groups with cap`}</small>
  </div>`;
}

export const cms = { node: { css: ["pub/main.css"], js: ["pub/main.js"], render } };
