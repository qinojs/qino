import { html } from "@qino/qino";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export default async function (node: Node): Promise<HtmlString | string> {
  if (await node.access() < 2) return "";
  const count = Number(await node.app.db.one`SELECT count(*) FROM page_redirect WHERE redirect = ${node.id}`) || 0;
  return html.async`<span class=-title>${node.app.t`Urls`}</span> ${
    html.raw(count ? `<span class=-info>${count}</span>` : "")
  }`;
}
