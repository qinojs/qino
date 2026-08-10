import { html, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";

/** PHP's `cms_text($Cont, $name, ['tag' => …])`: the text in its own tag, editable in edit mode.
 *  `title` is the node title there, not a text of that name. */
export async function cmsText(node: Node, name: string, tag = "div", attrs = ""): Promise<HtmlString> {
  const text = name === "title" ? await node.showTitle() : await node.showText(name);
  const edit = node.edit ? ` contenteditable cmstxt=${text.id}` : "";
  return html.raw(`<${tag}${attrs}${edit}>${text}</${tag}>`);
}
