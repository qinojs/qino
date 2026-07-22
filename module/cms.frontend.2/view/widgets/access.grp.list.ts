import { html, type HtmlString, sql, Sql, sqlSearch } from "../../../core/mod.ts";
import type { Node } from "../../../cms/mod.ts";

export default async function (node: Node, vars: { hasMany?: boolean; param?: Record<string, string> } = {}): Promise<HtmlString> {
  const app = node.app;
  const db = app.db;
  const hasMany = vars.hasMany ?? true;
  const search  = vars.param?.search ?? "";
  let tail: Sql;
  if (!hasMany) {
    tail = sql` ORDER BY a.access DESC `;
  } else if (search) {
    const sh = sqlSearch(search, ["grp.name"]);
    tail = sql` AND ${sh.where} ORDER BY ${sh.order}`;
  } else {
    tail = sql` AND NOT ISNULL(a.access) ORDER BY a.access DESC `;
  }

  const rows = await db.query`
    SELECT grp.*, a.access
    FROM grp
    LEFT JOIN page_access_grp a ON grp.id = a.grp_id AND a.page_id = ${node.id}
    WHERE cms_access ${tail}, grp.name LIMIT 100`;
  const publicAccess = node.vs.access;
  const trs: Array<HtmlString | Promise<HtmlString>> = [html.async`<tr>
    <td>${app.t`Public`}
    <td><input type=radio name=public value=0 ${!publicAccess ? "checked" : ""}>
    <td><input type=radio name=public value=1 ${publicAccess ? "checked" : ""}>
    <td><td>`];

  for (const vs of rows) {
    trs.push(html`<tr>
      <td>${vs.name}
      <td><input ${!vs.access ? "checked" : ""} type=radio name=g_${vs.id} value=0>
      <td><input ${vs.access == 1 ? "checked" : ""} type=radio name=g_${vs.id} value=1>
      <td><input ${vs.access == 2 ? "checked" : ""} type=radio name=g_${vs.id} value=2>
      <td><input ${vs.access == 3 ? "checked" : ""} type=radio name=g_${vs.id} value=3>`);
  }

  return html.async`<table id=cmsGrpAccessTable class=-styled style="width:100%">
  <thead><tr class=-vertical>
    <th style="text-align:left;width:auto">${app.t`Group`}
    <th><span class=-access-0>${app.t`no access`}</span>
    <th><span class=-access-1>${app.t`view`}</span>
    <th><span class=-access-2>${app.t`edit`}</span>
    <th><span class=-access-3>${app.t`administer`}</span>
  <tbody>${html.join(await Promise.all(trs))}
</table>
<style>#cmsGrpAccessTable input { display:block; margin:auto; }</style>`;
}
