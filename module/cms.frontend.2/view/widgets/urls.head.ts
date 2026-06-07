import type { Node } from "../../../cms/mod.ts";

export default async function (node: Node): Promise<string> {
  if ((await node.access()) < 2) return "";
  const count = Number(await node.app.db.one("SELECT count(*) FROM page_redirect WHERE redirect = ?", [String(node)]) ?? "0") || 0;
  const number = count ? `<span class=-info>${count}</span>` : "";
  return `<span class=-title>${await node.app.t`Urls`}</span> ${number}`;
}
