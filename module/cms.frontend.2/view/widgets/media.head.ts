import { html } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export default async function (node: Node): Promise<HtmlString | string> {
  if (await node.access() < 2) return "";
  const count = Object.keys(await node.files()).length;
  return html.async`<span class=-title>${node.app.t`Files`}</span> ${
    html.raw(count ? `<span class=-info>${count}</span>` : "")
  }`;
}
