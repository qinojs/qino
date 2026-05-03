import type { Node } from "../../../cms/lib/Node.ts";

export default async function (node: Node): Promise<string> {
  const t = node.app.languages.t;
  const isNull = node.vs.access === null;
  const P = await node.accessInheritParent();

  let inner: string;
  if (isNull) {
    inner = await t`Vererbt von ${node.cms.link(P)}`;
  } else {
    const hasMany = (parseInt(String(await node.app.db.one("SELECT count(*) FROM grp WHERE page_access") ?? "0")) || 0) > 10;
    const searchInput = hasMany ? `<input class=-search placeholder="${await node.app.t`Suchen`}">` : "";
    const { default: listFn } = await import("./access.grp.list.ts");
    const listHtml = await listFn(node, { hasMany });
    inner = `${searchInput}<div widget="access.grp.list">${listHtml}</div>`;
  }

  return `<div class=qgCmsFront1AccessGrpManager pid=${node}>
  <label style="display:block;margin-bottom:10px">
    <input class=-inherit type=checkbox value="${isNull ? 0 : 1}" ${isNull ? "checked" : ""}>
    ${await t`Gruppen-Berechtigungen vererbt`}
  </label>
  ${inner}
</div>`;
}
