import { sql, Sql } from "../../../core/mod.ts";
import type { Node } from "../../../cms/mod.ts";

export default async function (node: Node, vars: { hasMany?: boolean; param?: Record<string, string> } = {}): Promise<string> {
  const app = node.app;
  const db = app.db;
  const hasMany = vars.hasMany ?? true;
  const search  = vars.param?.search ?? "";
  let tail: Sql;
  if (!hasMany) {
    tail = sql` ORDER BY a.access DESC `;
  } else if (search) {
    const like = "%" + search + "%";
    tail = sql` AND (grp.name LIKE ${like})
      ORDER BY grp.name = ${search} DESC, grp.name LIKE ${search + "%"} DESC, grp.name LIKE ${like} DESC `;
  } else {
    tail = sql` AND NOT ISNULL(a.access) ORDER BY a.access DESC `;
  }

  const rows = await db.all`
    SELECT grp.*, a.access
    FROM grp
    LEFT JOIN page_access_grp a ON grp.id = a.grp_id AND a.page_id = ${String(node)}
    WHERE page_access ${tail}, grp.name LIMIT 100`;
  const publicAccess = node.vs.access;
  let trs = `<tr>
    <td>${await app.t`Public`}
    <td><input type=radio name=public value=0 ${!publicAccess ? "checked" : ""}>
    <td><input type=radio name=public value=1 ${publicAccess ? "checked" : ""}>
    <td><td>`;

  for (const vs of rows) {
    trs += `<tr>
      <td>${vs.name}
      <td><input ${!vs.access ? "checked" : ""} type=radio name=g_${vs.id} value=0>
      <td><input ${vs.access == 1 ? "checked" : ""} type=radio name=g_${vs.id} value=1>
      <td><input ${vs.access == 2 ? "checked" : ""} type=radio name=g_${vs.id} value=2>
      <td><input ${vs.access == 3 ? "checked" : ""} type=radio name=g_${vs.id} value=3>`;
  }

  return `<table id=cmsGrpAccessTable class=-styled style="width:100%">
  <thead><tr class=-vertical>
    <th style="text-align:left;width:auto">${await app.t`Group`}
    <th><span class=-access-0>${await app.t`no access`}</span>
    <th><span class=-access-1>${await app.t`view`}</span>
    <th><span class=-access-2>${await app.t`edit`}</span>
    <th><span class=-access-3>${await app.t`administer`}</span>
  <tbody>${trs}
</table>
<style>#cmsGrpAccessTable input { display:block; margin:auto; }</style>`;
}
