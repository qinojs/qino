import { hee } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";

/** PHP's `cms_image2_bg()` emitted `data-cms-image2-bg` plus a blurred preview, and its JS swapped
 *  in a fitting size. qino's cms.image2 only ports the foreground `<cms-image2>`, so this is a plain
 *  CSS background — same picture, no lazy upgrade. */
export async function backgroundAttr(node: Node, fileName: string, style = ""): Promise<string> {
  const file = await node.file(fileName);
  if (await file.exists()) {
    const url = await file.url({ w: 1920, q: 78 });
    style = `background-image:url(${url}); ${style}`;
  }
  return style ? ` style="${hee(style)}"` : "";
}
