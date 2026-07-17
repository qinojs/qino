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
    const sh = sqlSearch(search, ["usr.firstname", "usr.lastname", "usr.email"]);
    tail = sql` AND ${sh.where} ORDER BY ${sh.order}`;
  } else {
    tail = sql` AND NOT ISNULL(a.access) ORDER BY a.access DESC `;
  }

  const rows = await db.query`
    SELECT usr.*, a.access
    FROM usr
    LEFT JOIN page_access_usr a ON usr.id = a.usr_id AND a.page_id = ${String(node)}
    WHERE true ${tail}, usr.firstname LIMIT 100`;
  const trs: HtmlString[] = [];
  for (const vs of rows) {
    trs.push(html`<tr>
      <td>${vs.email}
      <td><input ${!vs.access ? "checked" : ""} type=radio name=u_${vs.id} value=0>
      <td><input ${vs.access == 1 ? "checked" : ""} type=radio name=u_${vs.id} value=1>
      <td><input ${vs.access == 2 ? "checked" : ""} type=radio name=u_${vs.id} value=2>
      <td><input ${vs.access == 3 ? "checked" : ""} type=radio name=u_${vs.id} value=3>`);
  }

  return html.async`<table id=cmsUsrAccessTable class=-styled style="width:100%">
  <thead><tr class=-vertical>
    <th style="text-align:left;width:auto">${app.t`User`}
    <th><span class=-access-0>${app.t`no access`}</span>
    <th><span class=-access-1>${app.t`view`}</span>
    <th><span class=-access-2>${app.t`edit`}</span>
    <th><span class=-access-3>${app.t`administer`}</span>
  <tbody>${html.join(trs)}
</table>
<style>#cmsUsrAccessTable input { display:block; margin:auto; }</style>`;
}
