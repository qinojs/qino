import type { Node } from "../../../cms/lib/Node.ts";

export default async function (node: Node): Promise<string> {
  const app = node.app;
  const hasMany = (Number(await app.db.one("SELECT count(*) FROM usr") ?? "0") || 0) > 10;
  const searchInput = hasMany ? `<input class=-search placeholder="${await app.t`Suchen`}">` : "";
  const { default: listFn } = await import("./access.usr.list.ts");
  const listHtml = await listFn(node, { hasMany });
  return `<div class=qgCmsFront1AccessUsrManager pid=${node}>
  ${searchInput}
  <div widget="access.usr.list">${listHtml}</div>
</div>`;
}
