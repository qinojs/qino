import { html } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export default async function (node: Node): Promise<HtmlString | string> {
  if (await node.access() < 2) return "";
  const number = await node.isOnline() ? "" : `<span class=-info>!</span>`;
  return html.async`<span class=-title>${node.app.t`Schedule`}</span> ${html.raw(number)}`;
}
