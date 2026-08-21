import { assertEquals, assertRejects } from "@std/assert";
import { App, Ctx, requestStorage } from "@qino/qino";
import { cms } from "@qino/qino/cms";

import { adoptCart } from "../lib/cart.ts";
import { cart, shp3 } from "../mod.ts";

import type { Currency, Order, Product } from "../mod.ts";

const round = (v: number, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;

// Prices include VAT (the default), so a 12.00 cup is 11.10 net at 8.1 %.
async function shop(...modules: string[]) {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../../module/store.json")).add("cms").add("messaging").add("messaging.email").add("cron").add("cron").add("locale.country").add("locale.currency");
  app.modules.add(import.meta.resolve("../plugin.ts"), "shp3");
  for (const m of modules) app.modules.add(import.meta.resolve(`../../${m}/plugin.ts`), m);
  await app.init();
  const db = app.db;
  await db.table("page").insert({ id: 10, name: "Cup", access: 1 });
  await db.table("page").insert({ id: 11, name: "Plate", access: 1 });
  await db.table("shp3_product").insert({ id: 10, price: 12, weight: 0.5 });
  await db.table("shp3_product").insert({ id: 11, price: 3.33, weight: 0.2 });
  await db.table("shp3_product_mwst").insert({ product_id: 10, country: "CH", rate: 8.1 });
  return app;
}

const newOrder = (app: App) => app.db.table("shp3_order").add<Order>({ ship_country: "CH", currency: "CHF" });

Deno.test("shp3: a cart adds up, places, and freezes its values", async () => {
  await using app = await shop();
  const order = (await newOrder(app))!;

  const cup = await order.itemAdd(10, 2);
  assertEquals(cup.title, "10"); // accessor, no await — untitled page, so the id stands in
  assertEquals(cup.quantity, 2);
  assertEquals(round(cup.onePrice()), 11.1);

  await order.itemAdd(10, 1); // same product, same config → one row
  assertEquals((await order.items()).length, 1);
  assertEquals(cup.quantity, 3);

  const costs = await order.costs();
  assertEquals(round(costs.net), 33.3);
  assertEquals(round(costs.taxes["8.1"]), 2.7);
  assertEquals(costs.gross, 36); // 3 × 12.00 gross

  await order.place();
  assertEquals(cup.vat_rate, 8.1); // frozen while placing
  assertEquals(order.cost, 36);
  assertEquals(order.cost_real, 36); // currency factor 1
  await assertRejects(() => order.place(), Error, "already placed");
});

Deno.test("shp3: a price event bends the price", async () => {
  await using app = await shop();
  // Half price from ten pieces on — the kind of rule a discount module adds.
  shp3(app).on("price-discount", (e: { quantity?: number; price: number }) => {
    if ((e.quantity ?? 0) >= 10) e.price = e.price / 2;
  });
  const order = (await newOrder(app))!;
  const item = await order.itemAdd(10, 10);
  assertEquals(round(item.onePrice()), 5.55);
  assertEquals(round(await item.rowGross()), 60);

  await item.setQuantity(2); // below the threshold again
  assertEquals(round(item.onePrice()), 11.1);
});

Deno.test("shp3: generated items join the total and are written when placing", async () => {
  await using app = await shop();
  shp3(app).on("generated-items", (e: { items: unknown[] }) => {
    e.items.push({ name: "shipping", title: "Shipping", price: 7, vat_rate: 8.1, sort: 1 });
  });
  const order = (await newOrder(app))!;
  await order.itemAdd(11, 1);
  assertEquals(round((await order.costs()).gross), 10.33); // 3.33 + 7.00

  await order.place();
  const rows = await app.db.query`SELECT name, price FROM shp3_order_item_generated WHERE order_id = ${String(order)}`;
  assertEquals(rows.length, 1);
  assertEquals(round(rows[0].price), 6.48); // the 7.00 gross was stored net
});

Deno.test("shp3: a product without its own rate takes the country's", async () => {
  await using app = await shop();
  await app.db.table("shp3_product_mwst").insert({ product_id: 11, country: "DE", rate: 7 });
  const plate = (await app.db.table("shp3_product").get<Product>(11))!;
  assertEquals(await plate.vatRateFor("DE"), 7); // its own
  assertEquals(await plate.vatRateFor("CH"), 8.1); // the country's
  assertEquals(await plate.vatRateFor("SO"), 0); // a country with no rate at all
});

Deno.test("shp3: payment and shipping methods come from the settings", async () => {
  await using app = await shop("shp3.payment.invoice", "shp3.payment.advance", "shp3.shipping.pickup");
  const order = (await newOrder(app))!;
  assertEquals(await order.allowedShippings(), {}); // nothing to carry, nothing to choose
  await order.itemAdd(10, 1);
  assertEquals(await order.allowedShippings(), { pickup: "Abholung" });
  assertEquals(await order.activeShipping(), "pickup"); // the only one

  assertEquals(Object.keys(await order.allowedPayments()).sort(), ["advance", "invoice"]);
  assertEquals(await order.activePayment(), "invoice"); // auto-select takes the first

  await app.settings.shp3.payments.advance.sort(-1); // the shop reorders the list
  assertEquals(Object.keys(await order.allowedPayments()), ["advance", "invoice"]);
  assertEquals(await order.activePayment(), "advance");

  order.payment = "invoice";
  assertEquals(await order.activePayment(), "invoice");

  await app.settings.shp3.payments.invoice.enabled("");
  assertEquals(Object.keys(await order.allowedPayments()), ["advance"]);
});

Deno.test("shp3: shipping is a line of the order and pickup is free", async () => {
  await using app = await shop("shp3.shipping.pickup");
  const order = (await newOrder(app))!;
  await order.itemAdd(10, 1);
  const generated = await order.generatedItems();
  assertEquals(generated.map((g) => g.name), ["shipping"]);
  assertEquals(generated[0].price, 0);
  assertEquals(generated[0].vat_rate, 8.1); // highest rate of the goods it moves
  assertEquals((await order.costs()).gross, 12);
});

Deno.test("shp3: stock caps the amount and drops when the order is placed", async () => {
  await using app = await shop("shp3.stock");
  await app.db.table("shp3_product").update(10, { stock: 5, stock_is_fix: true });
  const order = (await newOrder(app))!;
  const item = await order.itemAdd(10, 9);
  assertEquals(item.quantity, 5); // capped, not refused

  await order.place();
  assertEquals(await app.db.one`SELECT stock FROM shp3_product WHERE id = ${10}`, 0);
});

Deno.test("shp3: an order with errors is not placed", async () => {
  await using app = await shop("shp3.shipping.pickup", "shp3.payment.invoice");
  // The checks speak to the customer, so they need the request's language.
  const ctx = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
  await requestStorage.run(ctx, async () => {
  const order = (await newOrder(app))!;
  const empty = await order.tryPlace();
  assertEquals(empty.success, false);
  assertEquals(Object.keys(empty.errors), ["has items"]);
  assertEquals(order.time_ordered, 0);

  await order.itemAdd(10, 1);
  const full = await order.tryPlace();
  assertEquals(full.errors, {});
  assertEquals(full.success, true);
  assertEquals(order.shipping, "pickup");
  assertEquals(order.payment, "invoice");
  });
});

Deno.test("shp3: the price passes four phases, in order", async () => {
  await using app = await shop();
  const seen: string[] = [];
  for (const phase of ["initial", "additions", "discount", "final"]) {
    shp3(app).on(`price-${phase}` as never, (e: { price: number }) => {
      seen.push(`${phase}:${e.price}`);
      if (phase === "initial") e.price = 100;
      if (phase === "additions") e.price += 20;
      if (phase === "discount") e.price *= 0.5;
      if (phase === "final") e.price = Math.round(e.price);
    });
  }
  const cup = (await app.db.table("shp3_product").get<Product>(10))!;
  assertEquals((await cup.pricesFor({})).gross, 60);
  assertEquals(seen, ["initial:12", "additions:100", "discount:120", "final:60"]);
});

Deno.test("shp3: a product whose page is not public cannot be sold", async () => {
  await using app = await shop();
  const ctx = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
  await requestStorage.run(ctx, async () => {
    const cup = (await app.db.table("shp3_product").get<Product>(10))!;
    assertEquals(await cup.errors(), {});

    await app.db.table("page").update(10, { access: 0 });
    const plate = (await app.db.table("shp3_product").get<Product>(11))!;
    await app.db.table("page").update(11, { access: 0 });
    assertEquals(Object.keys(await plate.errors()), ["no access"]);
  });
});

Deno.test("shp3: a rounding step survives the float noise of a legacy FLOAT column", async () => {
  await using app = await shop();
  // What the real database hands over for 0.01 and 0.05 once a FLOAT column became DOUBLE.
  await app.db.table("shp3_currency").update("CHF", { smallest: 0.009999999776482582, smallest_closing: 0.05000000074505806 });
  const chf = (await app.db.table("shp3_currency").get<Currency>("CHF"))!;
  assertEquals(chf.show(12), "CHF 12.00");
  assertEquals(chf.round(12.007), 12.01);
  assertEquals(chf.closing(10.33), 10.35);
});

Deno.test("shp3: an item takes the page title, falling through an empty translation", async () => {
  await using app = await shop();
  const ctx = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
  await requestStorage.run(ctx, async () => {
    const cup = await cms(app).node(10);
    await cup.title("en", "Teddy");
    await cup.title("de", ""); // never translated — an empty string, not a missing row

    const order = (await newOrder(app))!;
    order.lang = "de";
    const item = await order.itemAdd(10, 1);
    assertEquals(item.title, "Teddy");
  });
});

Deno.test("shp3: the countries the shop sells to, and what they cost", async () => {
  await using app = await shop();
  const db = app.db;
  // nothing marked yet: the shop sells everywhere and stands nowhere
  assertEquals((await shp3(app).countries()).length, 250);
  assertEquals(await shp3(app).sellsTo("DE"), true);
  assertEquals(await shp3(app).country(), "");

  await db.table("country").update({ id: "CH", shp3_enabled: true });
  await db.table("country").update({ id: "DE", shp3_enabled: true });
  assertEquals(await shp3(app).countries(), ["CH", "DE"]);
  assertEquals(await shp3(app).sellsTo("US"), false);
  assertEquals(await shp3(app).country(), "CH"); // no setting: the first one marked

  // an order without a country is priced where the shop stands
  const order = (await app.db.table("shp3_order").add<Order>({ currency: "CHF" }))!;
  assertEquals(order.shipCountry(), "");
  const plate = (await db.table("shp3_product").get<Product>(11))!;
  assertEquals(await plate.vatRateFor(order.shipCountry()), 8.1); // CH, from the country row
  assertEquals(await plate.vatRateFor("DE"), 19);
});

Deno.test("shp3: what the guest collected follows them into the login", async () => {
  await using app = await shop();
  const ctx = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
  await requestStorage.run(ctx, async () => {
    const guest = (await cart(ctx))!;
    await guest.itemAdd(10, 2);
    await app.db.flush();

    // an older cart of that user must not win over the one in their hands
    const stale = (await app.db.table("shp3_order").add<Order>({ usr_id: 7 }))!;
    await app.db.flush();

    // what login() hands over: the session's values, taken before it was emptied
    await adoptCart(app, { oldSession: ctx.sess.data(), usrId: 7 });

    assertEquals(Number(guest.usr_id), 7);
    assertEquals((await guest.items()).length, 1);
    assertEquals(Number(await app.db.one`SELECT usr_id FROM shp3_order WHERE id = ${stale.$id}`), 0); // released
  });
});

Deno.test("shp3: fresh reference rates become the shop's factors", async () => {
  await using app = await shop();
  const db = app.db;
  // CHF is the shop's main currency; the rates say what one USD buys
  await db.table("currency").update({ id: "CHF", rate_to_usd: 0.8 });
  await db.table("currency").update({ id: "EUR", rate_to_usd: 0.88 });
  await db.table("currency").update({ id: "USD", rate_to_usd: 1 });

  await shp3(app).syncFactors();
  await db.flush();

  assertEquals(await db.one`SELECT factor FROM shp3_currency WHERE id = ${"CHF"}`, 1); // the yardstick
  assertEquals(Number(await db.one`SELECT factor FROM shp3_currency WHERE id = ${"EUR"}`).toFixed(4), "1.1000");
  assertEquals(Number(await db.one`SELECT factor FROM shp3_currency WHERE id = ${"USD"}`).toFixed(4), "1.2500");
  assertEquals(await db.one`SELECT factor FROM shp3_currency WHERE id = ${"GBP"}`, 0.78); // no rate, untouched
});
