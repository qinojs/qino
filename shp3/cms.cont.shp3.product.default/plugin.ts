import { html, type HtmlString } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { ensureProduct, mainCurrency } from "../shp3/mod.ts";
import api from "./nodeApi.ts";

export const name = "cms.cont.shp3.product.default";
export const description = "Product page: price and the button that puts it into the cart.";
export const needs = ["shp3", "cms"];

const settingsSchema = {
  properties: {
    quantity: { type: "boolean", default: true, description: "Whether the customer can pick an amount." },
  },
};

/** A product is a page — the page id is the product id, and the row is created with it. */
async function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  const product = await ensureProduct(node.app.db, node.id);
  if (!product) return html.async`<div></div>`;

  const currency = await mainCurrency(node.app.db);
  const prices = await product.pricesFor({ currency, quantity: 1 });
  const errors = Object.values(await product.errors());

  return html.async`<div>
  <div class=-price>${currency ? currency.show(prices.gross) : prices.gross}</div>
  ${errors.length
    ? html`<div class=-errors>${html.join(errors.map((e) => html`<div>${e}</div>`))}</div>`
    : html`<form class=-add>
    ${await node.settings.quantity() === false ? "" : html`<input type=number name=quantity min=1 step=1 value=1>`}
    <button>${await t`Add to cart`}</button>
  </form>`}
</div>`;
}

export const cms = { node: { render, api, js: ["pub/main.js"], settingsSchema } };
