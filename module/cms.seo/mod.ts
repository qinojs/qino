import type { DbFile } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** A page text as plain text, without creating it when missing. */
export async function text(page: Node, name: string): Promise<string> {
  return (await page.texts()).has(name) ? (await page.showText(name)).plain() : "";
}

/** How the page image fills a box: photos are cropped at their focal point, SVGs (logos, graphics)
 *  fitted whole. */
export const fit = (file: DbFile): "cover" | "contain" => file.mime === "image/svg+xml" ? "contain" : "cover";

/** The page image for a w×h box, by `fit`; SVGs rasterized, since sharing platforms reject them. */
export async function imageUrl(file: DbFile, w: number, h: number): Promise<string> {
  return file.url(fit(file) === "contain" ? { w, h, max: true, fmt: "png" }
    : { w, h, hpos: Number(await file.get("hpos") ?? 50), vpos: Number(await file.get("vpos") ?? 50) });
}

/** The page's image: file "share", else "main". */
export async function image(page: Node) {
  const files = await page.files();
  return ["share", "main"].map((name) => files.get(name)).find((file) => file?.mime.startsWith("image/"));
}
