import { html, type HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import { ensureProduct, shp3 } from "@qino/qino/shp3";

const settingsSchema = {
  properties: {
    quantity: { type: "boolean", default: true, description: "Whether the customer can pick an amount." },
  },
};

/** A product is a page — the page id is the product id, and the row is created with it. */
async function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  const product = await ensureProduct(node);
  if (!product) return html.async`<div></div>`;

  const currency = await shp3(node.app).mainCurrency();
  const prices = await product.pricesFor({ currency, quantity: 1 });
  const errors = Object.values(await product.errors());

  // A plain [shp3-add] form: the shared client script picks it up wherever it sits, and
  // [shp3-price] follows the amount live.
  return html.async`<div>
  <div class=-price>${currency?.id ?? ""} <span shp3-price=gross>${currency ? currency.format(prices.gross) : prices.gross}</span></div>
  ${errors.length
    ? html`<div class=-errors>${html.join(errors.map((e) => html`<div>${e}</div>`))}</div>`
    : html`<form shp3-add class=-add>
    <input type=hidden name=product_id value=${product.id}>
    ${await node.settings.quantity() === false ? "" : html`<input type=number name=quantity min=1 step=1 value=1>`}
    <button>${await t`Add to cart`}</button>
  </form>`}
</div>`;
}

export const cms = { node: { render, js: ["../shp3/pub/shp3.js"], settingsSchema } };
