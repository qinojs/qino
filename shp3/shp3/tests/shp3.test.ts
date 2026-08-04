import { assertEquals, assertRejects } from "@std/assert";
import { App, Ctx, requestStorage } from "../../../module/core/mod.ts";
import type { Order, Product } from "../mod.ts";

const round = (v: number, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;

// Prices include VAT (the default), so a 12.00 cup is 11.10 net at 8.1 %.
async function shop(...modules: string[]) {
  const app = new App({ db: "sqlite::memory:", appPATH: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../../module/store.json")).add("cms").add("mail");
  app.modules.add(import.meta.resolve("../plugin.ts"), "shp3");
  for (const m of modules) app.modules.add(import.meta.resolve(`../../${m}/plugin.ts`), m);
  await app.init();
  const db = app.db;
  await db.table("page").insert({ id: 10, name: "Cup" });
  await db.table("page").insert({ id: 11, name: "Plate" });
  await db.table("shp3_product").insert({ id: 10, price: 12, weight: 0.5 });
  await db.table("shp3_product").insert({ id: 11, price: 3.33, weight: 0.2 });
  await db.table("shp3_product_vat").insert({ product_id: 10, country: "CH", rate: 8.1 });
  return app;
}

const newOrder = (app: App) => app.db.table("shp3_order").add<Order>({ ship_country: "CH", currency: "CHF" });

Deno.test("shp3: a cart adds up, places, and freezes its values", async () => {
  const app = await shop();
  try {
    const order = (await newOrder(app))!;

    const cup = await order.itemAdd(10, 2);
    assertEquals(cup.title, "Cup"); // accessor, no await
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
  } finally {
    await app.db.close();
  }
});

Deno.test("shp3: a price event bends the price", async () => {
  const app = await shop();
  try {
    // Half price from ten pieces on — the kind of rule a discount module adds.
    app.on("shp3:price", (e: { quantity?: number; price: number }) => {
      if ((e.quantity ?? 0) >= 10) e.price = e.price / 2;
    });
    const order = (await newOrder(app))!;
    const item = await order.itemAdd(10, 10);
    assertEquals(round(item.onePrice()), 5.55);
    assertEquals(round(await item.rowGross()), 60);

    await item.setQuantity(2); // below the threshold again
    assertEquals(round(item.onePrice()), 11.1);
  } finally {
    await app.db.close();
  }
});

Deno.test("shp3: generated items join the total and are written when placing", async () => {
  const app = await shop();
  try {
    app.on("shp3:generated-items", (e: { items: unknown[] }) => {
      e.items.push({ name: "shipping", title: "Shipping", price: 7, vat_rate: 8.1, sort: 1 });
    });
    const order = (await newOrder(app))!;
    await order.itemAdd(11, 1);
    assertEquals(round((await order.costs()).gross), 10.35); // 3.33 + 7.00, rounded to 0.05

    await order.place();
    const rows = await app.db.query`SELECT name, price FROM shp3_order_item_generated WHERE order_id = ${String(order)}`;
    assertEquals(rows.length, 1);
    assertEquals(round(rows[0].price), 6.48); // the 7.00 gross was stored net
  } finally {
    await app.db.close();
  }
});

Deno.test("shp3: a product without a country rate uses the shop default", async () => {
  const app = await shop();
  try {
    const plate = (await app.db.table("shp3_product").get<Product>(11))!;
    assertEquals(await plate.vatRateFor("CH"), 0);
    const cup = (await app.db.table("shp3_product").get<Product>(10))!;
    assertEquals(await cup.vatRateFor("CH"), 8.1);
  } finally {
    await app.db.close();
  }
});

Deno.test("shp3: payment and shipping methods come from the settings", async () => {
  const app = await shop("shp3.payment.invoice", "shp3.payment.advance", "shp3.shipping.pickup");
  try {
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
  } finally {
    await app.db.close();
  }
});

Deno.test("shp3: shipping is a line of the order and pickup is free", async () => {
  const app = await shop("shp3.shipping.pickup");
  try {
    const order = (await newOrder(app))!;
    await order.itemAdd(10, 1);
    const generated = await order.generatedItems();
    assertEquals(generated.map((g) => g.name), ["shipping"]);
    assertEquals(generated[0].price, 0);
    assertEquals(generated[0].vat_rate, 8.1); // highest rate of the goods it moves
    assertEquals((await order.costs()).gross, 12);
  } finally {
    await app.db.close();
  }
});

Deno.test("shp3: stock caps the amount and drops when the order is placed", async () => {
  const app = await shop("shp3.stock");
  try {
    await app.db.table("shp3_product").update(10, { stock: 5, stock_is_fix: true });
    const order = (await newOrder(app))!;
    const item = await order.itemAdd(10, 9);
    assertEquals(item.quantity, 5); // capped, not refused

    await order.place();
    assertEquals(await app.db.one`SELECT stock FROM shp3_product WHERE id = ${10}`, 0);
  } finally {
    await app.db.close();
  }
});

Deno.test("shp3: an order with errors is not placed", async () => {
  const app = await shop("shp3.shipping.pickup", "shp3.payment.invoice");
  try {
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
  } finally {
    await app.db.close();
  }
});
