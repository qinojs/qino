import { html } from "@qino/qino";

import { accessRadios, accessTable, accessTail } from "../accessList.ts";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export default async function (node: Node, vars: { hasMany?: boolean; param?: Record<string, string> } = {}): Promise<HtmlString> {
  const app = node.app;
  const hasMany = vars.hasMany ?? true;
  const search  = vars.param?.search ?? "";
  const tail = accessTail(hasMany, search, ["usr.given_name", "usr.family_name", "usr.username"]);

  const rows = await app.db.query`
    SELECT usr.*, a.access
    FROM usr
    LEFT JOIN page_access_usr a ON usr.id = a.usr_id AND a.page_id = ${node.id}
    WHERE true ${tail}, usr.given_name LIMIT 100`;
  const trs = [];
  for (const vs of rows) {
    trs.push(html`<tr>
      <td>${vs.username}
      ${accessRadios(`u_${vs.id}`, vs.access)}`);
  }

  return accessTable(app, "Usr", app.t`User`, html.join(trs));
}
