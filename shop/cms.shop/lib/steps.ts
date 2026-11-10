import type { Node } from "@qino/qino/cms";

/** The page a checkout step links to, by setting: a page id, `auto`, or empty for none. `auto`
 *  goes back to the previous page (else the parent), or on to the first page below (else the next
 *  one, else the parent). */
export async function stepUrl(node: Node, value: unknown, direction: "back" | "next"): Promise<string> {
  const v = String(value ?? "").trim();
  if (!v) return "";
  if (v !== "auto") return (await node.cms.node(Number(v))).url();
  const page = await node.page(), parent = await page.parent();
  const pages = (n?: Node) => n ? n.children().then((m) => [...m.values()].filter((c) => c.vs.type === "p")) : [];
  const siblings = await pages(parent);
  const i = siblings.findIndex((n) => n.id === page.id);
  const found = direction === "back" ? siblings[i - 1] ?? parent : (await pages(page))[0] ?? siblings[i + 1] ?? parent;
  return found ? found.url() : "";
}
