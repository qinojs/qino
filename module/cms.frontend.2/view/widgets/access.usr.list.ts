import type { Node } from "../../../cms/mod.ts";

export default async function (node: Node, vars: { hasMany?: boolean; param?: Record<string, string> } = {}): Promise<string> {
  const app = node.app;
  const db = app.db;
  const hasMany = vars.hasMany ?? true;
  const search  = vars.param?.search ?? "";
  const params: unknown[] = [String(node)];

  let sql = ` SELECT usr.*, a.access
    FROM usr
    LEFT JOIN page_access_usr a ON usr.id = a.usr_id AND a.page_id = ?
    WHERE true `;

  if (!hasMany) {
    sql += " ORDER BY a.access DESC ";
  } else if (search) {
    sql += ` AND (usr.lastname LIKE ? OR usr.firstname LIKE ? OR usr.email LIKE ?)
      ORDER BY usr.firstname = ? DESC, usr.lastname = ? DESC, usr.email = ? DESC,
               usr.firstname LIKE ? DESC, usr.lastname LIKE ? DESC, usr.email LIKE ? DESC,
               usr.firstname LIKE ? DESC, usr.lastname LIKE ? DESC, usr.email LIKE ? DESC `;
    params.push("%" + search + "%", "%" + search + "%", "%" + search + "%", search, search, search, search + "%", search + "%", search + "%", "%" + search + "%", "%" + search + "%", "%" + search + "%");
  } else {
    sql += " AND NOT ISNULL(a.access) ORDER BY a.access DESC ";
  }
  sql += ", usr.firstname LIMIT 100";

  const rows = await db.all(sql, params);
  let trs = "";
  for (const vs of rows) {
    trs += `<tr>
      <td>${vs.email}
      <td><input ${!vs.access ? "checked" : ""} type=radio name=u_${vs.id} value=0>
      <td><input ${vs.access == 1 ? "checked" : ""} type=radio name=u_${vs.id} value=1>
      <td><input ${vs.access == 2 ? "checked" : ""} type=radio name=u_${vs.id} value=2>
      <td><input ${vs.access == 3 ? "checked" : ""} type=radio name=u_${vs.id} value=3>`;
  }

  return `<table id=cmsUsrAccessTable class=-styled style="width:100%">
  <thead><tr class=-vertical>
    <th style="text-align:left;width:auto">${await app.t`User`}
    <th><span class=-access-0>${await app.t`no access`}</span>
    <th><span class=-access-1>${await app.t`view`}</span>
    <th><span class=-access-2>${await app.t`edit`}</span>
    <th><span class=-access-3>${await app.t`administer`}</span>
  <tbody>${trs}
</table>
<style>#cmsUsrAccessTable input { display:block; margin:auto; }</style>`;
}
