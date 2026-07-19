import { html, type HtmlString } from "../../../core/mod.ts";
import type { Node } from "../../../cms/mod.ts";

export default async function (node: Node): Promise<HtmlString | string> {
  if ((await node.access()) < 2) return "";
  const count = Number(await node.app.db.one`SELECT count(*) FROM page_redirect WHERE redirect = ${node}`) || 0;
  const number = count ? `<span class=-info>${count}</span>` : "";
  return html.async`<span class=-title>${node.app.t`Urls`}</span> ${html.raw(number)}`;
}
