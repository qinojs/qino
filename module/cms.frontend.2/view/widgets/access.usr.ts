import { html, type HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export default async function (node: Node): Promise<HtmlString> {
  const app = node.app;
  const hasMany = Number(await app.db.one`SELECT count(*) FROM usr`) > 10;
  const searchInput = hasMany ? html.async`<input class=-search placeholder="${app.t`Search`}">` : "";
  const { default: listFn } = await import("./access.usr.list.ts");
  const listHtml = await listFn(node, { hasMany });
  return html.async`<div class=access-users-manager pid=${node.id}>
  ${searchInput}
  <div widget="access.usr.list">${listHtml}</div>
</div>`;
}
