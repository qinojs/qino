import type { Node } from "@qino/qino/cms";
import type { Product } from "./lib/rows.ts";

export { Currency, idOf, Line, Order, Product, refOf, Variant } from "./lib/rows.ts";
export { cart } from "./lib/cart.ts";
export { stepUrl } from "./lib/steps.ts";
export { appOf, countries, country, currency, currencyFor, mainCurrency, sellsTo, settingsOf, shopT, taxIncluded, taxRate } from "./lib/shop.ts";
export type { Errors, Extra, Method, Party, PriceQuery, ShippingProvider, Status } from "./lib/rows.ts";

/** The product row of a page that renders as one, created on first sight. */
export async function ensureProduct(node: Node): Promise<Product> {
  const table = node.app.db.table("shop_product");
  return await table.get<Product>(node.id) ?? (await table.add<Product>({ id: node.id }))!;
}

/** Where a product is shown: the page it sits on, asked for this product alone. Products are
 *  contents, not pages, so they have no address of their own. */
export async function productUrl(product: Product, lang?: string): Promise<string> {
  const page = await (await product.node()).page();
  return `${await page.url(lang)}?shop_product=${product.$id}`;
}
