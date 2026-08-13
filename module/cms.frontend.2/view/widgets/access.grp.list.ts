import { html, type HtmlString } from "@qino/qino";
import { accessRadios, accessTable, accessTail } from "../accessList.ts";
import type { Node } from "@qino/qino/cms";

export default async function (node: Node, vars: { hasMany?: boolean; param?: Record<string, string> } = {}): Promise<HtmlString> {
  const app = node.app;
  const hasMany = vars.hasMany ?? true;
  const search  = vars.param?.search ?? "";
  const tail = accessTail(hasMany, search, ["grp.name"]);

  const rows = await app.db.query`
    SELECT grp.*, a.access
    FROM grp
    LEFT JOIN page_access_grp a ON grp.id = a.grp_id AND a.page_id = ${node.id}
    WHERE cms_access ${tail}, grp.name LIMIT 100`;
  const publicAccess = node.vs.access;
  const trs: HtmlString[] = [await html.async`<tr>
    <td>${app.t`Public`}
    <td><input type=radio name=public value=0 ${!publicAccess ? "checked" : ""}>
    <td><input type=radio name=public value=1 ${publicAccess ? "checked" : ""}>
    <td><td>`];

  for (const vs of rows) {
    trs.push(html`<tr>
      <td>${vs.name}
      ${accessRadios(`g_${vs.id}`, vs.access)}`);
  }

  return accessTable(app, "Grp", app.t`Group`, html.join(trs));
}
