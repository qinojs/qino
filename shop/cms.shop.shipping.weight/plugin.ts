import type { App } from "@qino/qino";
import type { Order, ShippingProvider } from "@qino/qino/cms.shop";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

/** Tariffs by weight and country: the cheapest rate whose weight is above the parcel's. */
export const shippingProvider: ShippingProvider = {
  name: "weight",

  // only tariffs that have rates for the country
  async methods(app: App, order: Order) {
    const names = await app.db.col<string>`SELECT DISTINCT method FROM shop_shipping_rate WHERE country = ${order.country} ORDER BY method`;
    return names.map((name) => ({ name, label: name })); // what the customer reads: cms.shop's labels
  },

  async cost(app: App, order: Order, method: string) {
    const weight = await order.weight();
    if (!weight) return 0;
    const free = await app.db.one`SELECT amount FROM shop_shipping_free WHERE country = ${order.country} AND method = ${method}`;
    if (free && await order.goods() >= Number(free)) return 0;
    const price = await app.db.one`SELECT MIN(price) FROM shop_shipping_rate WHERE country = ${order.country} AND method = ${method} AND weight > ${weight}`;
    if (price != null) return Number(price);
    // heavier than every rate: the heaviest rate, in proportion
    const top = await app.db.row`SELECT weight, price FROM shop_shipping_rate WHERE country = ${order.country} AND method = ${method} ORDER BY weight DESC LIMIT 1`;
    return top ? weight / (Number(top.weight) + 0.1) * Number(top.price) : 0;
  },
};
