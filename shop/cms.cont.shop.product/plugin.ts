import { html } from "@qino/qino";
import { cart, country, ensureProduct, mainCurrency, shopT } from "@qino/qino/cms.shop";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    cart: { type: "integer", description: "Page to go to once something is in the cart; none: stay." },
  },
};

/** A product is a page: its id is the product's, the row comes with it. One row per variant to
 *  order several at once, else the product itself. */
async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const app = node.app, t = shopT(app);
  const product = await ensureProduct(node);
  const order = await cart(ctx, false);
  const currency = await order?.currencyRow() ?? await mainCurrency(app);
  const where = order?.country ?? await country(app);
  const variants = await product.variants();
  const cartId = Number(await node.settings.cart() || 0);
  const action = cartId ? await (await node.cms.node(cartId)).url() : "";

  const rows = [];
  for (const variant of variants.length ? variants : [undefined]) {
    const [{ gross }, errors] = await Promise.all([product.prices({ variant, order, currency }), product.errors(variant)]);
    const message = Object.values(errors)[0];
    rows.push(html.async`<tr ${variant ? html`data-variant=${variant.id}` : ""}>
      <td class=-title>${variant ? variant.title(ctx.lang) : product.title(ctx.lang)}
      <td class=-price>${currency?.show(gross) ?? gross}
      <td class=-quantity>${message
        ? html`<span class=-error>${message}</span>`
        : html.async`<input name=quantity type=number min=0 step=1 value="${variants.length ? 0 : 1}" aria-label="${t`Quantity`}">`}`);
  }
  return html.async`<div>
  ${node.cms.text(node, "title", { tag: "h2", class: "-title" })}
  ${node.cms.text(node, "main", { class: "-text", if: true })}
  <form shop-add ${action ? html`action=${action}` : ""} class=-buy>
    <input type=hidden name=product value="${product.id}">
    <table class=u2-table><tbody>${rows}</tbody></table>
    ${product.fields({ order, currency })}
    <small class=-tax>${t`including VAT`} ${product.taxRate(where)}%</small>
    <button>${t`Add to cart`}</button>
  </form>
</div>`;
}

export const cms = { node: { render, js: ["../cms.shop/pub/shop.js"], settingsSchema } };
