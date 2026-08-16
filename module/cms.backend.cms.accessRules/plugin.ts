import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { invalidateStandards } from "@qino/qino/cms.accessRules";

import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Access rules", de: "Zugriffsregeln" });
}

const clamp = (v: unknown, min = 0) => Math.min(Math.max(min, Number(v) || 0), 3);
const level = (v: unknown) => (v === "" || v == null ? "" : String(clamp(v)));

/** One handler for every edit: override cell, CAP row, standard column, bulk (standard/override), add group. */
function save(node: Node, vars: Record<string, unknown>): Promise<void> {
  return node.app.db.transaction(() => saveTx(node, vars));
}
async function saveTx(node: Node, vars: Record<string, unknown>): Promise<void> {
  const app = node.app;
  const modules = () => String(vars.modules ?? "").split(",").filter(Boolean);
  const setOverride = async (module: string, grpId: number, access: string) => {
    const table = app.db.table("cms_module_access_grp"), id = { module, grp_id: grpId };
    if (access === "") await table.delete(id);
    else await table.ensure({ ...id, access: Number(access) });
  };
  const setStandard = (module: string, access: string) =>
    app.db.table("module").update(module, { cms_access: access === "" ? null : Number(access) });

  if (vars.set_override !== undefined) { // single override cell
    const module = String(vars.module ?? ""), grpId = Number(vars.grp) || 0;
    if (module && grpId) await setOverride(module, grpId, level(vars.access));
  } else if (vars.set_cap !== undefined) { // grp.cms_access
    const grpId = Number(vars.grp) || 0;
    if (grpId) await app.db.table("grp").update(grpId, { cms_access: clamp(vars.access, 1) });
  } else if (vars.set_standard !== undefined) { // module.cms_access
    const module = String(vars.module ?? "");
    if (module) await setStandard(module, level(vars.access));
    invalidateStandards(app);
  } else if (vars.bulk_standard !== undefined) { // set standard of many modules
    for (const m of modules()) await setStandard(m, level(vars.access));
    invalidateStandards(app);
  } else if (vars.bulk_override !== undefined) { // set one group's override for many modules
    const grpId = Number(vars.grp) || 0;
    if (grpId) for (const m of modules()) await setOverride(m, grpId, level(vars.access));
  } else if (vars.add_group !== undefined) { // promote/create a group into the matrix
    let grpId = Number(vars.grp) || 0;
    if (!grpId && vars.new_group && (node.settings.canCreateGroups() ?? true)) {
      grpId = Number(await app.db.table("grp").insert({ name: String(vars.new_group).trim() }));
    }
    if (grpId) await app.db.table("grp").update(grpId, { cms_access: clamp(vars.cap, 1) });
  }
}

async function render(node: Node, { vars = {} }: { vars?: Record<string, unknown> }): Promise<HtmlString> {
  const app = node.app, t = app.t;
  await save(node, vars);

  const groupRows = await app.db.query`SELECT id, name, cms_access FROM grp WHERE cms_access ORDER BY name`;
  const overrides = new Map<string, number>();
  for (const r of await app.db.query`SELECT module, grp_id, access FROM cms_module_access_grp`)
    overrides.set(`${r.module}:${r.grp_id}`, Number(r.access) || 0);
  const modRows = new Map((await app.db.query`
    SELECT m.name, m.cms_access, (SELECT COUNT(*) FROM page WHERE module = m.name) AS used FROM module m`)
    .map((r) => [String(r.name), r]));

  // labels (plain html`` doesn't await app.t) + value→word map for the coloured cells
  const [lGroup, lName, lNew, lCap, lRead, lEdit, lInsertable, lAdd, lSearch, lSet, lNone, lDeny, lSave, lStd] = await Promise.all(
    [t`Group`, t`Name`, t`new group`, t`Cap`, t`read`, t`edit`, t`insertable`, t`add`, t`Search`, t`Set checked`, t`— none —`, t`deny`, t`save`, t`standard`]);
  const word: Record<string, string> = { "": "–", "0": lDeny, "1": lRead, "2": lEdit, "3": lInsertable };

  const head = groupRows.map((g) => html`<th data-sort-handler title="${g.name}"><div>${g.name}</div>`);
  const capCells = groupRows.map((g) =>
    html`<td class=-cell data-kind=cap data-grp="${g.id}" v="${g.cms_access}">${word[String(g.cms_access)]}`);

  const trParts = [];
  let total = 0;
  for (const mod of app.modules.linked().sort((a, b) => a.name.localeCompare(b.name))) {
    if (!mod.plugin.cms?.node?.render) continue;
    const module = mod.name;
    const row = modRows.get(module);
    if (!row) continue;
    total++;
    const std = row.cms_access == null ? "" : String(row.cms_access);
    const cells = groupRows.map((g) => {
      const raw = overrides.has(`${module}:${g.id}`) ? String(overrides.get(`${module}:${g.id}`)) : "";
      // show the effective value — an override above the group's CAP is clamped by it
      const v = raw === "" ? "" : String(Math.min(Number(raw), Number(g.cms_access) || 3));
      return html`<td class=-cell data-kind=override data-module="${module}" data-grp="${g.id}" data-raw="${raw}" v="${v}">${word[v]}`;
    });
    trParts.push(html`<tr data-name="${module}">
      <td><input type=checkbox data-check>
      <td>${module}
      <td style="text-align:right">${Number(row.used) || ""}
      <td class=-cell data-kind=standard data-module="${module}" v="${std}">${word[std]}
      ${cells}`);
  }

  const canCreate = node.settings.canCreateGroups() ?? true;
  const other = await app.db.query`SELECT id, name FROM grp WHERE cms_access IS NULL OR cms_access = 0 ORDER BY name`;
  const bulkCols = groupRows.map((g) => html`<option value="${g.id}">${g.name}`);

  return html.async`<div class="u2-flex cmsAccessRules" data-labels="${JSON.stringify(word)}">
  <div class="u2-card -matrix" style="flex:1 1 43.75rem; max-height:90vh; overflow:auto">
    <div class=-head>${t`Access rules`}</div>
    <div class="-body -toolbar">
      <div>
        <input type=search data-search placeholder="${lSearch}…">
        <label>${lSet}:
          <select data-bulk><option value="">${lNone}<option value=0>${lDeny}<option value=1>${lRead}<option value=2>${lEdit}<option value=3>${lInsertable}</select>
          <select data-bulk-col><option value=standard>${lStd}${bulkCols}</select>
          <button data-bulk-apply type=button>${lSave}</button>
        </label>
      </div>
      <span class=-legend>
        <span><i class=-a1></i>${lRead}</span><span><i class=-a2></i>${lEdit}</span><span><i class=-a3></i>${lInsertable}</span>
      </span>
    </div>
    <u2-table style="padding:0">
      <table class="u2-table -Sticky" style="white-space:nowrap;">
        <thead>
          <tr style="position:relative; z-index:1">
            <th><input type=checkbox data-check-all>
            <th data-sort-handler>${t`Module`}
            <th data-sort-handler>${t`Used`}
            <th data-sort-handler title="${t`Default for everyone; deny = module off`}">${lStd}
            ${head}
          <tr class=-cap>
            <td>
            <td><b>CAP</b>
            <td>–
            <td>–
            ${capCells}
        <tbody>${trParts}
        <tfoot><tr><td colspan="${4 + groupRows.length}">${t`Total`}: ${total}
      </table>
    </u2-table>
  </div>

  <div class="u2-card -add" style="flex:0 0 auto">
    <div class=-head>${t`Add group`}</div>
    <form class=-add-group>
      <label>${lGroup}<br><select name=grp>
        ${canCreate ? html`<option value="">— ${lNew} —` : ""}
        ${other.map((g) => html`<option value="${g.id}">${g.name}`)}
      </select></label>
      ${canCreate ? html`<label>${lName}<br><input name=new_group></label>` : ""}
      <label>${lCap}<br><select name=cap>
        <option value=1>${lRead}<option value=2>${lEdit}<option value=3>${lInsertable}
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

export const cms = {
  node: {
    css: ["pub/main.css"],
    js: ["pub/main.js"],
    render,
    settingsSchema: { properties: {
      canCreateGroups: { type: "boolean", default: true }
    }},
  },
};
