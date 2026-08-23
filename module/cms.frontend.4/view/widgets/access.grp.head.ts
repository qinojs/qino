import { html } from "@qino/qino";

import { accessCounts } from "../accessList.ts";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export default async function (node: Node): Promise<HtmlString | string> {
  if (await node.access() < 3) return "";
  const page = await node.accessInheritParent();
  const isPublic = await page.isPublic();
  const number = (!isPublic ? `<span class=-info style="font-family:qg_cms;">&#xe900;</span>` : "") +
    await accessCounts(node.app, "page_access_grp", page.id);
  return html.async`<span class=-title>${node.app.t`Group access`}</span> ${html.raw(number)}`;
}
