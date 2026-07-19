import { html, type HtmlString } from "../../../core/mod.ts";
import type { Node } from "../../../cms/mod.ts";

export default async function (node: Node): Promise<HtmlString | string> {
  if ((await node.access()) < 3) return "";
  const all = await node.app.db.row`SELECT sum(if(access=1,1,0)) as access_1, sum(if(access=2,1,0)) as access_2, sum(if(access=3,1,0)) as access_3 FROM page_access_usr WHERE page_id = ${node}`;
  let number = "";
  if (all) {
    if (all.access_1) number += `<span class="-info -access-1-bg">${all.access_1}</span>`;
    if (all.access_2) number += `<span class="-info -access-2-bg">${all.access_2}</span>`;
    if (all.access_3) number += `<span class="-info -access-3-bg">${all.access_3}</span>`;
  }
  return html.async`<span class=-title>${node.app.t`User access`}</span> ${html.raw(number)}`;
}
