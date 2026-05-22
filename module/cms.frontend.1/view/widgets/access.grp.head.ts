import type { Node } from "../../../cms/lib/Node.ts";

export default async function (node: Node): Promise<string> {
  if ((await node.access()) < 3) return "";
  const P = await node.accessInheritParent();
  const isPublic = await P.isPublic();
  let number = !isPublic ? `<span class=-info style="font-family:qg_cms;">&#xe900;</span>` : "";
  const all = await node.app.db.row("SELECT sum(if(access=1,1,0)) as access_1, sum(if(access=2,1,0)) as access_2, sum(if(access=3,1,0)) as access_3 FROM page_access_grp WHERE page_id = ?", [String(P)]);
  if (all) {
    if (all.access_1) number += `<span class="-info -access-1-bg">${all.access_1}</span>`;
    if (all.access_2) number += `<span class="-info -access-2-bg">${all.access_2}</span>`;
    if (all.access_3) number += `<span class="-info -access-3-bg">${all.access_3}</span>`;
  }
  return `<span class=-title>${await node.app.t`Group access`}</span> ${number}`;
}
