import { hee } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";

/** PHP's `cms_image2_bg()` emitted `data-cms-image2-bg` plus a blurred preview, and its JS swapped
 *  in a fitting size. qino's cms.image2 only ports the foreground `<cms-image2>`, so this is a plain
 *  CSS background — same picture, no lazy upgrade. The focus point stored on the file becomes
 *  `background-position`, as in the PHP templates. */
export async function backgroundStyle(node: Node, fileName: string, params: Record<string, unknown> = { w: 1920, q: 78 }): Promise<string> {
  const file = await node.file(fileName);
  if (!await file.exists()) return "";
  let style = `background-image:url(${await file.url(params)});`;
  const hpos = await file.get("hpos");
  const vpos = await file.get("vpos");
  if (hpos != null || vpos != null) style += `background-position:${Number(hpos) || 50}% ${Number(vpos) || 50}%;`;
  return style;
}

export async function backgroundAttr(node: Node, fileName: string, style = ""): Promise<string> {
  style = await backgroundStyle(node, fileName) + style;
  return style ? ` style="${hee(style)}"` : "";
}

/** #rgb, #rrggbb or rgb(); undefined when the value is none of them. */
function rgb(color: string): [number, number, number] | undefined {
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  }
  const parts = color.match(/^rgba?\(([^)]+)\)$/i)?.[1].split(/[\s,/]+/).map(Number);
  if (parts && parts.length >= 3) return parts.slice(0, 3) as [number, number, number];
}

/** The section modules of the PHP CMS all shared this style block: background image, an optional
 *  `background-color` setting, and white text once that colour is dark. */
export async function sectionAttr(node: Node, fileName = "Background"): Promise<string> {
  let style = await backgroundStyle(node, fileName);
  const color = String(await node.settings["background-color"] ?? "");
  if (color) {
    style += `background-color:${color};`;
    const parts = rgb(color);
    if (parts && 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2] < 180) style += "color:#fff;";
  }
  return style ? ` style="${hee(style)}"` : "";
}
