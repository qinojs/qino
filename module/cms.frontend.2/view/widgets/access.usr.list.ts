import { html, type HtmlString } from "../../../core/mod.ts";
import { accessRadios, accessTail } from "../accessList.ts";
import type { Node } from "../../../cms/mod.ts";

export default async function (node: Node, vars: { hasMany?: boolean; param?: Record<string, string> } = {}): Promise<HtmlString> {
  const app = node.app;
  const db = app.db;
  const hasMany = vars.hasMany ?? true;
  const search  = vars.param?.search ?? "";
  const tail = accessTail(hasMany, search, ["usr.firstname", "usr.lastname", "usr.email"]);

  const rows = await db.query`
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
