import { sql } from "@qino/qino";

import type { App } from "@qino/qino";
import type { Order, ShippingProvider } from "@qino/qino/cms.shop";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

/** What a line ships for: the rate of the highest step its amount reaches; none below the first. */
const rateOf = (app: App, product: unknown, quantity: number) =>
  app.db.one`SELECT price FROM shop_shipping_product WHERE product_id = ${product} AND min_quantity <= ${quantity} ORDER BY min_quantity DESC LIMIT 1`;

/** Delivery by the products: every line adds the rate of its product for its amount. */
export const shippingProvider: ShippingProvider = {
  name: "product",

  // offered where a product of the order has rates
  async methods(app: App, order: Order) {
    const ids = (await order.lines()).map((l) => l.product_id);
    if (!ids.length || await app.db.one`SELECT 1 FROM shop_shipping_product WHERE product_id IN (${sql.join(ids.map((id) => sql`${id}`))}) LIMIT 1` == null) return [];
    return [{ name: "", label: "" }]; // what the customer reads: cms.shop's labels
  },

  all: () => [{ name: "", label: "" }],

  async cost(app: App, order: Order) {
    let cost = 0;
    for (const line of await order.lines()) cost += Number(await rateOf(app, line.product_id, Number(line.quantity)) ?? 0);
    return cost;
  },
};
