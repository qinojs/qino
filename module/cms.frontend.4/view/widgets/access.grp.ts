import { html } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export default async function (node: Node): Promise<HtmlString> {
  const t = node.app.t;
  const isNull = node.vs.access === null;
  const page = await node.accessInheritParent();

  let inner: string;
  if (isNull) {
    inner = await t`Inherited from ${node.cms.link(page)}`;
  } else {
    const hasMany = Number(await node.app.db.one`SELECT count(*) FROM grp WHERE cms_access`) > 10;
    const searchInput = hasMany ? `<input class=-search placeholder="${await t`Search`}">` : "";
    const { default: listFn } = await import("./access.grp.list.ts");
    const listHtml = await listFn(node, { hasMany });
    inner = `${searchInput}<div widget="access.grp.list">${listHtml}</div>`;
  }

  return html.async`<div class=access-groups-manager pid=${node.id}>
  <label style="display:block;margin-bottom:.625rem">
    <input class=-inherit type=checkbox value="${isNull ? 0 : 1}" ${isNull ? "checked" : ""}>
    ${t`Group permissions inherited`}
  </label>
  ${html.raw(inner)}
</div>`;
}
