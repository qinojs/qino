import type { Node } from "@qino/qino/cms";
import type { Product } from "./lib/rows.ts";

export { Currency, idOf, Line, Order, Product, refOf, shippingMethods, Variant } from "./lib/rows.ts";
export { cart } from "./lib/cart.ts";
export { stepUrl } from "./lib/steps.ts";
export { methodStep, orderTable } from "./lib/view.ts";
export { appOf, countries, country, currencies, currency, currencyFor, grpsOf, listen, listOf, mainCurrency, sellsTo, settingsOf, shopT, taxIncluded, taxRate } from "./lib/shop.ts";
export type { Errors, Extra, Method, Party, PriceQuery, ShippingProvider, Solution, Status } from "./lib/rows.ts";

/** The product row of a page that renders as one, created on first sight. */
export async function ensureProduct(node: Node): Promise<Product> {
  const table = node.app.db.table("shop_product");
  return await table.get<Product>(node.id) ?? (await table.add<Product>({ id: node.id }))!;
}

/** Where a product is shown: its own address in a category, else its page, without the anchor. */
export async function productUrl(product: Product, lang?: string): Promise<string> {
  return (await (await product.node()).url(lang)).split("#")[0];
}
