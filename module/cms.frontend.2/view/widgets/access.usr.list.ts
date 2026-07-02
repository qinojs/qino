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
    const pre = search + "%", like = "%" + search + "%";
    tail = sql` AND (usr.lastname LIKE ${like} OR usr.firstname LIKE ${like} OR usr.email LIKE ${like})
      ORDER BY usr.firstname = ${search} DESC, usr.lastname = ${search} DESC, usr.email = ${search} DESC,
               usr.firstname LIKE ${pre} DESC, usr.lastname LIKE ${pre} DESC, usr.email LIKE ${pre} DESC,
               usr.firstname LIKE ${like} DESC, usr.lastname LIKE ${like} DESC, usr.email LIKE ${like} DESC `;
  } else {
    tail = sql` AND NOT ISNULL(a.access) ORDER BY a.access DESC `;
  }

  const rows = await db.query`
    SELECT usr.*, a.access
    FROM usr
    LEFT JOIN page_access_usr a ON usr.id = a.usr_id AND a.page_id = ${String(node)}
    WHERE true ${tail}, usr.firstname LIMIT 100`;
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
