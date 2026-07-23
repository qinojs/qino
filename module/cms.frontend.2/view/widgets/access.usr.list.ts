import { html, type HtmlString } from "../../../core/mod.ts";
import { accessRadios, accessTable, accessTail } from "../accessList.ts";
import type { Node } from "../../../cms/mod.ts";

export default async function (node: Node, vars: { hasMany?: boolean; param?: Record<string, string> } = {}): Promise<HtmlString> {
  const app = node.app;
  const hasMany = vars.hasMany ?? true;
  const search  = vars.param?.search ?? "";
  const tail = accessTail(hasMany, search, ["usr.firstname", "usr.lastname", "usr.email"]);

  const rows = await app.db.query`
    SELECT usr.*, a.access
    FROM usr
    LEFT JOIN page_access_usr a ON usr.id = a.usr_id AND a.page_id = ${node.id}
    WHERE true ${tail}, usr.firstname LIMIT 100`;
  const trs: HtmlString[] = [];
  for (const vs of rows) {
    trs.push(html`<tr>
      <td>${vs.email}
      ${accessRadios(`u_${vs.id}`, vs.access)}`);
  }

  return accessTable(app, "Usr", app.t`User`, html.join(trs));
}
