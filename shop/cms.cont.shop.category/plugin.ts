import { html, sql } from "@qino/qino";

import type { Node } from "@qino/qino/cms";

/** The products below: each one renders itself, with its own add-to-cart form; one of them alone
 *  at its own address. */
async function render(node: Node) {
  const child = node.cms.requestedChild(node);
  if (child) return html.async`<div>${child}</div>`;
  const conts = [...(await node.children()).values()].filter((c) => c.vs.type === "c");
  const ids = conts.length ? new Set((await node.app.db.col`SELECT id FROM shop_product WHERE id IN (${sql.join(conts.map((c) => sql`${c.id}`), ", ")})`).map(Number)) : new Set();
  const products = [];
  for (const child of conts) if (ids.has(child.id) && await child.isReadable()) products.push(child.html());
  return html.async`<div>
  ${node.cms.text(node, "title", { tag: "h2", class: "-title" })}
  <div class=-products>${products}</div>
</div>`;
}

export const cms = { node: { render, childUrls: true } };
