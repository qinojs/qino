import type { Node } from "../../../cms/lib/Node.ts";
// deno-lint-ignore-file no-explicit-any

export default async function (node: Node, vars: any = {}): Promise<string> {
  const app = node.app;
  const db = app.db;
  const hasMany = vars.hasMany ?? true;
  const search  = vars.param?.search ?? "";
  const params: any[] = [];

  let sql = ` SELECT grp.*, a.access
    FROM grp
    LEFT JOIN page_access_grp a ON grp.id = a.grp_id AND a.page_id = '${node}'
    WHERE page_access `;

  if (!hasMany) {
    sql += " ORDER BY a.access DESC ";
  } else if (search) {
    sql += ` AND (grp.name LIKE ?)
      ORDER BY grp.name = ? DESC, grp.name LIKE ? DESC, grp.name LIKE ? DESC `;
    params.push("%" + search + "%", search, search + "%", "%" + search + "%");
  } else {
    sql += " AND NOT ISNULL(a.access) ORDER BY a.access DESC ";
  }
  sql += ", grp.name LIMIT 100";

  const rows = await db.all(sql, params);
  const publicAccess = node.vs.access;
  let trs = `<tr>
    <td>${await app.t`Öffentlich`}
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
    <th style="text-align:left;width:auto">${await app.t`Gruppe`}
    <th><span class=-access-0>${await app.t`kein Zugriff`}</span>
    <th><span class=-access-1>${await app.t`sehen`}</span>
    <th><span class=-access-2>${await app.t`bearbeiten`}</span>
    <th><span class=-access-3>${await app.t`administrieren`}</span>
  <tbody>${trs}
</table>
<style>#cmsGrpAccessTable input { display:block; margin:auto; }</style>`;
}
