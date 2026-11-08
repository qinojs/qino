import { App, s } from "@qino/qino";

import { adopt } from "./lib/cart.ts";
import { idOf, registerRows } from "./lib/rows.ts";
import { bind, CACHED, forget, shopT, syncFactors } from "./lib/shop.ts";

import type { EventDecls } from "@qino/qino";
import type { Extra, Order } from "./lib/rows.ts";

export { api } from "./api.ts";
export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const settingsSchema = {
  properties: {
    taxIncluded: { type: "boolean", default: true, description: "Product prices contain VAT." },
    country: { type: "string", maxLength: 2, description: "Where the shop stands: prices are calculated for it until the customer names a country." },
    payments: { type: "string", description: "Payment methods offered, in this order, as fin.payment names them (saferpay.twint, qrbill). Empty: all that fit." },
    shippings: { type: "string", description: "Delivery methods offered, in this order (weight.a, pickup). Empty: all that fit." },
    labels: {
      additionalProperties: { additionalProperties: { type: "string" } },
      description: "What the customer reads per method and language (labels → weight.a → de: Priority); none: the provider's name.",
    },
  },
};

const row = s.any();
const errors = s.record<string>().describe("Key → message; fill in what blocks.");
const price = s.object({
  product: row, variant: s.optional(row), price: s.number().describe("Unit price in minor units of the currency; change it."),
  quantity: s.number(), order: s.optional(row), currency: s.optional(row), country: s.string(),
  usrId: s.optional(s.number()), data: s.any(), time: s.number().describe("Unix time the price is asked for."),
});

Object.assign(App.events, {
  "shop:price-initial": { description: "Pass 1 of a unit price: the base (a variant, a fixed price in a currency).", data: price },
  "shop:price-additions": { description: "Pass 2 of a unit price: surcharges.", data: price },
  "shop:price-discount": { description: "Pass 3 of a unit price: discounts.", data: price },
  "shop:price-final": { description: "Pass 4 of a unit price: rounding.", data: price },
  "shop:product-check": { description: "What keeps a product (or a variant of it) out of a cart.", data: s.object({ product: row, variant: s.optional(row), errors }) },
  "shop:line-check": { description: "What is wrong with a line of a cart.", data: s.object({ line: row, errors }) },
  "shop:order-check": { description: "What blocks an order from being placed.", data: s.object({ order: row, errors }) },
  "shop:line-quantity": { description: "The amount of a line as it may be — stock, packaging units.", data: s.object({ line: row, quantity: s.number() }) },
  "shop:line-weight": { description: "The weight of one unit of a line, in grams.", data: s.object({ line: row, weight: s.number() }) },
  "shop:line-description": { description: "What the customer reads below a line's name.", data: s.object({ line: row, description: s.string() }) },
  "shop:extras": { description: "Lines the shop adds itself: shipping, surcharges, vouchers. Same key replaces.", data: s.object({ order: row, extras: s.array(s.any()) }) },
  "shop:shippings": { description: "Delivery methods for this order; remove what does not fit.", data: s.object({ order: row, methods: s.array(s.any()) }) },
  "shop:payments": { description: "Payment methods for this order; remove what does not fit.", data: s.object({ order: row, methods: s.array(s.any()) }) },
  "shop:cart": { description: "A cart was created for a visitor.", data: s.object({ order: row, ctx: s.any() }) },
  "shop:place": { description: "Last word before an order is placed: set prevent, add errors or a redirect.", data: s.object({ order: row, errors, prevent: s.boolean(), redirect: s.string() }) },
  "shop:pay": { description: "A payment for an order is about to start; change what it settles (ref) or says.", data: s.object({ order: row, payment: s.record() }) },
  "shop:ordered": { description: "An order was placed — mail, invoice, stock, export.", data: s.object({ order: row }) },
  "shop:status": { description: "An order moved on (ordered, paid, canceled) — once per change.", data: s.object({ order: row, previous: s.string() }) },
} satisfies EventDecls);

// Starting points only — rates change, the shop maintains them from there.
const TAX_RATES = "AT 20, BE 21, BG 20, HR 25, CY 19, CZ 21, DK 25, EE 22, FI 25.5, FR 20, DE 19, GR 24, HU 27, IE 23," +
  " IT 22, LV 21, LT 21, LU 17, MT 18, NL 21, NO 25, PL 23, PT 23, RO 19, SK 23, SI 22, ES 21, SE 25, CH 8.1, LI 8.1, GB 20";

/** Seed VAT rates and a main currency where there are none. */
export async function install({ app }: { app: App }): Promise<void> {
  const db = app.db;
  for (const entry of TAX_RATES.split(",")) {
    const [id, rate] = entry.trim().split(" ");
    await db.exec`UPDATE country SET shop_tax_rate = ${Number(rate)} WHERE id = ${id} AND shop_tax_rate IS NULL`;
  }
  if (await db.one`SELECT id FROM shop_currency LIMIT 1`) return;
  await db.table("shop_currency").insert({ id: "CHF", factor: 1, rounding: 5, active: true, main: true });
  await db.table("shop_currency").insert({ id: "EUR", factor: 1, rounding: 1, active: false, main: false });
}

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  bind(app);
  registerRows(app);
  const t = shopT(app);
  // deno-lint-ignore no-explicit-any -- payloads are declared above, as data
  const on = (event: string, fn: (e: any) => unknown) => app.on(event, fn as never, { signal });

  for (const event of ["table:insert-after", "table:update-after", "table:delete-after"] as const) {
    app.db.on(event, ({ table }) => { if (CACHED.includes(table.name)) forget(app, table.name); }, { signal });
  }

  on("auth:login", (e) => adopt(app, e));
  on("currency:rates", () => syncFactors(app)); // the factors follow fresh reference rates

  // Paid as fin says: the payments with the order's ref cover its total.
  on("payment:change", async ({ payment }) => {
    const id = idOf(payment.ref);
    if (!id) return;
    const order = await app.db.table("shop_order").get<Order>(id);
    if (order?.status !== "ordered") return;
    const paid = Number(await app.db.one`SELECT SUM(paid - refunded) FROM payment WHERE ref = ${payment.ref} AND direction = ${"in"}` ?? 0);
    if (paid >= Number(order.total)) await order.setStatus("paid");
  });

  // nothing to carry, nothing to deliver
  on("shop:shippings", async (e: { order: Order; methods: unknown[] }) => {
    if (await e.order.weight() <= 0) e.methods = [];
  });

  // Delivery is a line of its own, with the highest VAT rate of the goods it moves.
  on("shop:extras", async ({ order, extras }: { order: Order; extras: Extra[] }) => {
    const method = await order.activeShipping();
    if (!method) return;
    let rate = 0;
    for (const line of await order.lines()) rate = Math.max(rate, await line.taxRate());
    const label = (await order.shippings()).find((m) => m.name === method)?.label ?? method;
    extras.push({ key: "shipping", name: `${await t`Shipping`} ${label}`, price: await order.shippingCost(method), taxRate: rate, sort: 2 });
  });

  on("shop:order-check", async ({ order, errors }: { order: Order; errors: Record<string, string> }) => {
    const lines = await order.lines();
    if (!lines.length) errors["has lines"] = await t`Your shopping cart is empty`;
    if ((await order.shippings()).length && !await order.activeShipping()) errors["has shipping"] = await t`No delivery method is selected`;
    if ((await order.payments()).length && !await order.activePayment()) errors["has payment"] = await t`No payment method is selected`;
    if (!order.party("bill")?.address) errors["has address"] = await t`The address is missing`;
    for (const line of lines) {
      if (Object.keys(await line.errors()).length) errors["line errors"] = `${await t`Please check your shopping cart`}: ${line.name}`;
    }
  });

  on("shop:line-check", async ({ line, errors }) => {
    const product = await line.product();
    if (!product) return void (errors["not exists"] = await t`This product no longer exists`);
    if (line.variant_id && !await line.variant()) errors["not exists"] = await t`This variant no longer exists`;
    if (line.quantity <= 0) errors["quantity"] = await t`Not available in this quantity`;
    Object.assign(errors, await product.errors(await line.variant()));
  });

  on("shop:product-check", async ({ product, errors }) => {
    if (product.price < 0) errors["not orderable"] = await t`This product cannot be ordered`;
    // a product whose page went offline or private must not stay in a cart either
    const node = await product.node();
    if (await node.access() < 1 || !await node.isOnline()) errors["no access"] = await t`You have no access to this product`;
  });
}
