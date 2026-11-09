import { html } from "@qino/qino";
import { cart, country, currencyFor, shopT } from "@qino/qino/cms.shop";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** Nothing to choose from with one currency. */
async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const app = node.app, t = shopT(app);
  const ids = await app.db.col<string>`SELECT id FROM shop_currency WHERE active = ${true} ORDER BY main DESC, id`;
  if (ids.length < 2) return html`<div hidden></div>`;
  const order = await cart(ctx, false);
  const active = (await order?.currencyRow() ?? await currencyFor(app, await country(app)))?.$id;
  return html.async`<label><span class=-label>${t`Currency`}:</span>
  <select>${ids.map((id) => html`<option ${id === active ? html`selected` : ""}>${id}`)}</select>
</label>`;
}

export const cms = { node: { render, js: ["../cms.shop/pub/shop.js", "pub/main.js"] } };
