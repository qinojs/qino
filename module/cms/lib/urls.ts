// What a node's address is made of. A row in page_url is an address, or an anchor someone named; a
// content without one is an anchor in its page, computed and never stored.
import { fs, sql, tableRef, urlize } from "@qino/qino";

import type { Node } from "./Node.ts";

/** A content whose lister gives its children addresses: in effect a page of its own. */
export const hasOwnUrl = async (node: Node): Promise<boolean> =>
  node.vs.type === "c" && !!(await node.parent())?.module?.plugin.cms?.node?.childUrls;

/** The address it should have now, from its page or parent and its title; empty for an anchor. */
export async function generate(node: Node, lang: string): Promise<string> {
  if (node.vs.type === "c" && !await hasOwnUrl(node)) return "";
  const parent = node.vs.type === "c" ? await node.page() : await node.parent();
  const parentUrl = !parent || String(parent) === "1" ? lang : await parent.urlSeo(lang) || await generate(parent, lang);
  const title = await (await node.title()).orFallback(lang).then((t: any) => t.get()) ?? "";
  let url = parentUrl.replace(/\/?$/, "/") + (urlize(title) || (node.vs.type === "c" ? String(node.id) : ""));
  const taken = await node.app.db.one`SELECT page_id FROM ${sql.id(tableRef("page_url"))} WHERE url = ${url} AND NOT (page_id = ${node.id} AND lang = ${lang})`;
  if (taken || await fs.stat(node.app.dir + url)) url += "-" + lang + node;
  return url;
}
