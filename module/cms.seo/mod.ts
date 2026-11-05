import type { Node } from "@qino/qino/cms";

/** A page text as plain text, without creating it when missing. */
export async function text(page: Node, name: string): Promise<string> {
  return (await page.texts()).has(name) ? (await page.showText(name)).plain() : "";
}

/** The page's image: file "share", else "main". */
export async function image(page: Node) {
  const files = await page.files();
  return ["share", "main"].map((name) => files.get(name)).find((file) => file?.mime.startsWith("image/"));
}
