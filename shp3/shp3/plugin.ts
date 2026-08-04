import type { App } from "../../module/core/mod.ts";
import dbSchema from "./dbschema.json" with { type: "json" };
import { bindApp } from "./lib/shop.ts";
import { registerRows, type Order, type OrderItem, type Product } from "./lib/rows.ts";
import { adoptCart } from "./lib/cart.ts";
import { syncFactors } from "./lib/currency.ts";
import { cms } from "../../module/cms/mod.ts";
export { api } from "./apt.ts";

export const name = "shp3";
export const description = "Shop: products, cart, orders. Prices, VAT, shipping and payment are events.";
export const needs = ["core", "cms", "locale.country", "locale.currency"];
export { dbSchema };

// A method is one entry under payments/shippings — modules add themselves, the shop configures them.
const method = {
  additionalProperties: {
    properties: {
      enabled: { type: "boolean", default: true, description: "Whether the shop offers this method." },
      description: { type: "string", description: "Label shown to the customer." },
      sort: { type: "integer", default: 0, description: "Order in the list, lowest first." },
    },
  },
};

export const settingsSchema = {
  properties: {
    vat: {
      properties: {
        mode: { type: "string", enum: ["included", "excluded"], default: "included", description: "Whether product prices already contain VAT." },
      },
    },
    location: {
      properties: {
        country: { type: "string", maxLength: 2, description: "Where the shop stands. Prices are calculated for it until the customer names a country." },
        city: { type: "string", description: "The shop's own city." },
        street: { type: "string", description: "The shop's own street." },
      },
    },
    payments: method,
    shippings: method,
    default_product_module: { type: "string", default: "cms.cont.shp3.product.default", description: "The page module that marks a page as a product." },
    auto_select_payment: { type: "boolean", default: true, description: "Pick the first allowed payment method when none is chosen." },
    auto_select_shipping: { type: "boolean", default: true, description: "Pick the first allowed shipping method when none is chosen." },
  },
};

// Starting points only — VAT rates change, the shop maintains them from there.
const VAT_RATES = "AU 10, AT 20, BE 21, BG 20, HR 25, CY 19, CZ 21, DK 25, EE 22, FI 25.5, FR 20, DE 19, GR 24," +
  " HU 27, IN 18, IE 23, IT 22, JP 10, LV 21, LT 21, LU 17, MT 18, NL 21, NZ 15, NO 25, PL 23, PT 23, RO 19," +
  " SK 23, SI 22, ZA 15, KR 10, ES 21, SE 25, CH 8.1, LI 8.1, TW 5, GB 20";

/** A shop needs one currency to price anything, so the main one is seeded — and the countries
 *  it is most likely to sell to get a rate to start from. */
export async function install({ app }: { app: App }): Promise<void> {
  const countries = app.db.table("country");
  for (const entry of VAT_RATES.split(",")) {
    const [id, rate] = entry.trim().split(" ");
    if (await app.db.one`SELECT shp3_default_vat_rate FROM country WHERE id = ${id}` == null) {
      await countries.update({ id, shp3_default_vat_rate: Number(rate) });
    }
  }
  if (await app.db.one`SELECT id FROM shp3_currency LIMIT 1`) return;
  const currencies = app.db.table("shp3_currency");
  await currencies.insert({ id: "CHF", factor: 1, smallest: 0.01, smallest_closing: 0.05, active: true, main: true });
  for (const [id, factor] of [["EUR", 0.91], ["USD", 1.01], ["GBP", 0.78]] as [string, number][]) {
    await currencies.insert({ id, factor, smallest: 0.01, smallest_closing: 0.01, active: false, main: false });
  }
}

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  bindApp(app);
  registerRows(app.db);
  const t = app.t;
  const on = <T>(event: string, fn: (e: T) => unknown) => app.on(event, fn as never, { signal });

  // An anonymous cart follows its owner into the session they just logged into.
  on("auth:login", (e: Parameters<typeof adoptCart>[1]) => adoptCart(app, e));

  // Fresh reference rates: the shop's own factors follow them, relative to its main currency.
  on("currency:rates", () => syncFactors(app.db));

  // Shipping is a line of its own. It carries the highest VAT rate of the goods it moves.
  on("shp3:generated-items", async (e: { order: Order; items: Record<string, unknown>[] }) => {
    const shipping = await e.order.activeShipping();
    if (!shipping) return;
    let rate = 0;
    for (const item of await e.order.items()) rate = Math.max(rate, await item.calcVatRate());
    e.items.push({ name: "shipping", title: shipping, price: await e.order.shippingCost(shipping), vat_rate: rate });
  });

  // Nothing to carry means nothing to choose, and the same for nothing to pay.
  on("shp3:shippings", async (e: { order: Order; shippings: Record<string, string> }) => {
    if (await e.order.weight() <= 0) e.shippings = {};
  });
  on("shp3:payments", async (e: { order: Order; payments: Record<string, string> }) => {
    if ((await e.order.costs()).gross <= 0) e.payments = {};
  });

  // What has to hold before an order may be placed.
  on("shp3:order-check", async (e: { order: Order; errors: Record<string, string> }) => {
    const items = await e.order.items();
    if (!items.length) e.errors["has items"] = await t`Your shopping cart is empty`;
    if (Object.keys(await e.order.allowedShippings()).length && !await e.order.activeShipping()) {
      e.errors["has shipping"] = await t`No delivery method is selected`;
    }
    if (Object.keys(await e.order.allowedPayments()).length && !await e.order.activePayment()) {
      e.errors["has payment"] = await t`No payment method is selected`;
    }
    for (const item of items) {
      if (Object.keys(await item.errors()).length) e.errors["item errors"] = `${await t`Please check your shopping cart`}: ${item.title}`;
    }
  });

  on("shp3:item-check", async (e: { item: OrderItem; errors: Record<string, string> }) => {
    const product = await e.item.product();
    Object.assign(e.errors, product ? await product.errors() : { "not exists": await t`This product no longer exists` });
    // A price that drifted since it landed in the cart has to be shown, not silently applied.
    if (product && e.item.onePrice() < await e.item.calcPrice() * 0.999) e.errors["new prices"] = await t`The prices have changed`;
  });

  on("shp3:product-check", async (e: { product: Product; errors: Record<string, string> }) => {
    if (e.product.price < 0) e.errors["not orderable"] = await t`This product cannot be ordered`;
    // A product whose page went offline or private must not stay in a cart either.
    const node = await cms(app).node(Number(e.product.$id));
    if (await node.access() < 1) e.errors["no access"] = await t`You have no access to this product`;
  });
}
