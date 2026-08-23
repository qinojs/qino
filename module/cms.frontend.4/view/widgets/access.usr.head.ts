import { html } from "@qino/qino";

import { accessCounts } from "../accessList.ts";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export default async function (node: Node): Promise<HtmlString | string> {
  if (await node.access() < 3) return "";
  const number = await accessCounts(node.app, "page_access_usr", node.id);
  return html.async`<span class=-title>${node.app.t`User access`}</span> ${html.raw(number)}`;
}
