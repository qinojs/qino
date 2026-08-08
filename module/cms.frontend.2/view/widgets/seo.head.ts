import { html, type HtmlString } from "../../../core/mod.ts";
import type { Node } from "../../../cms/mod.ts";

export default async function (node: Node): Promise<HtmlString | string> {
  if (await node.access() < 2) return "";
  const hasDescr = (await (await node.text("_meta_description")).string())?.trim();
  return html.async`<span class=-title>${node.app.t`SEO`}</span> ${
    html.raw(hasDescr ? "" : `<span class=-info>!</span>`)
  }`;
}
