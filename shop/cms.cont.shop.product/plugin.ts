import { html } from "@qino/qino";
import { cmsCtx, hasOwnUrl } from "@qino/qino/cms";
import { cms_image } from "@qino/qino/cms.image";
import { cart, country, mainCurrency, shopT } from "@qino/qino/cms.shop";
import { jsonLd } from "@qino/qino/seo";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Product } from "@qino/qino/cms.shop";

const settingsSchema = {
  properties: {
    cart: { type: "integer", description: "Page to go to once something is in the cart; none: stay." },
  },
};

/** A product is a page: its id is the product's, the row comes with the module (`is`). One row per
 *  variant to order several at once, else the product itself. */
async function render(node: Node, { ctx }: { ctx: Ctx }) {
  const app = node.app, t = shopT(app);
  const product = await app.db.table("shop_product").get<Product>(node.id);
  if (!product) return html`<div></div>`;
  const order = await cart(ctx, false);
  const currency = await order?.currencyRow() ?? await mainCurrency(app);
  const where = order?.country ?? await country(app);
  // shp3 kept attachments under arbitrary names and used the first image in file order.
  const [variants, file] = await Promise.all([product.variants(), node.cms.image(node, { orFirst: true })]);
  const cartId = Number(await node.settings.cart || 0);
  const action = cartId ? await (await node.cms.node(cartId)).url() : "";

  const rows = [], offers = [], title = await product.title(ctx.lang);
  let orderable = false; // a button that can only fail is none
  for (const variant of variants.length ? variants : [undefined]) {
    const [{ gross }, errors] = await Promise.all([product.prices({ variant, order, currency }), product.errors(variant)]);
    const message = Object.values(errors)[0];
    if (!message) orderable = true;
    const label = variant ? await variant.title(ctx.lang) : title;
    // the price as shown, so the structured data says what the page says
    if (currency && gross >= 0) offers.push({
      "@type": "Offer", ...(variant && { name: label }),
      price: currency.format(gross), priceCurrency: currency.id,
      availability: `https://schema.org/${message ? "OutOfStock" : "InStock"}`,
    });
    rows.push(html.async`<tr ${variant ? html`data-variant=${variant.id}` : ""}>
      <td class=-title>${label}
      <td class=-price>${currency?.show(gross) ?? gross}
      <td class=-quantity>${message
        ? html`<span class=-error>${message}</span>`
        : html.async`<input name=quantity type=number min=0 step=1 value="${variants.length ? 0 : 1}" aria-label="${t`Quantity`}">`}`);
  }
  // where the product is what the page is about: at its own address if it has one (in a category,
  // whose list says nothing), else on its page
  const about = await hasOwnUrl(node) ? node : await node.page();
  const own = cmsCtx(ctx).requestedNode?.id === about.id;
  if (offers.length && own) jsonLd(ctx, {
    "@type": "Product", name: title,
    ...(file && { image: new URL(await file.url(), ctx.req.url.href).href }), // the original: search engines want them large
    ...(product.sku && { sku: product.sku }), ...(product.gtin && { gtin: product.gtin }),
    ...(product.brand && { brand: { "@type": "Brand", name: product.brand } }),
    offers,
  });
  // in a list, the title leads to the product's own page (not while editing: a click edits the title)
  const href = about === node && !own && !await node.edit() ? await node.url() : "";
  return html.async`<div>
  ${href ? html`<h2 class=-title><a href="${href}">${title}</a></h2>` : node.cms.text(node, "title", { tag: "h2", class: "-title" })}
  ${file ? cms_image(file, { alt: title, width: 500 }) : ""}
  ${node.cms.text(node, "main", { class: "-text", if: true })}
  <form shop-add ${action ? html`action="${action}"` : ""} class=-buy>
    <input type=hidden name=product value="${product.id}">
    <table class=u2-table><tbody>${rows}</tbody></table>
    ${product.fields({ order, currency })}
    <small class=-tax>${t`including VAT`} ${product.taxRate(where)}%</small>
    ${orderable ? html.async`<button>${t`Add to cart`}</button>` : ""}
  </form>
</div>`;
}

export const cms = { node: { render, is: ["shop_product"], js: ["../cms.shop/pub/shop.js"], settingsSchema } };
