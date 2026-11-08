import { test } from "node:test";
import { assertEquals } from "@qino/qino/tests";

import { asVisitor, withShop } from "../../tests/app.ts";
import { cart } from "../mod.ts";

import type { Product } from "../mod.ts";

test("a cart prices its lines, a variant its own price, totals as fin computes them", async () => {
  await withShop([], async (app) => {
    const variant = await app.db.table("shop_variant").insert({ product_id: 10, price: 3000, weight: 900 });
    await asVisitor(app, async (ctx) => {
      const order = (await cart(ctx))!;
      assertEquals([order.country, order.currency, !!order.tax_included], ["CH", "CHF", true]);
      const product = (await app.db.table("shop_product").get<Product>(10))!;
      await order.add(product, { quantity: 2 });
      await order.add(product, { variant: await product.variant(variant), quantity: 1 });
      await order.add(product, { quantity: 1 }); // same product, no variant: the amount rises
      const lines = await order.lines();
      assertEquals(lines.map((l) => [l.quantity, l.price]), [[3, 2450], [1, 3000]]);
      assertEquals(await order.weight(), 3 * 500 + 900);
      const { total, tax } = await order.totals();
      assertEquals(total, 3 * 2450 + 3000);
      assertEquals(tax, Math.round(10350 * 8.1 / 108.1));
    });
  });
});

test("the country decides tax and currency; nothing is placed without an address", async () => {
  await withShop([], async (app) => {
    await app.db.table("shop_currency").update({ id: "EUR", active: true, factor: 1.06 });
    await asVisitor(app, async (ctx) => {
      const order = (await cart(ctx))!;
      await order.add((await app.db.table("shop_product").get<Product>(10))!);
      await order.setCountry("DE");
      assertEquals(order.currency, "EUR");
      assertEquals((await order.lines())[0].price, 2450 * 1.06);
      assertEquals(Object.keys((await order.place()).errors), ["has address"]);

      await order.setParty("bill", { name: "Anna Muster", address: { addressCountry: "CH", postalCode: "3280" } });
      assertEquals([order.country, order.currency], ["CH", "CHF"]);
      const placed = await order.place();
      assertEquals(placed.ok, true);
      assertEquals(order.status, "ordered");
      assertEquals(order.total, 2450);
      assertEquals((await order.lines())[0].tax_rate, 8.1);
    });
  });
});

test("what every price asks is cached until its table changes; a cart forgets per request", async () => {
  await withShop(["cms.shop.minimum"], async (app) => {
    const product = (await app.db.table("shop_product").get<Product>(10))!;
    assertEquals(await product.taxRate("CH"), 8.1);
    await app.db.table("country").update({ id: "CH", shop_tax_rate: 7.7 });
    assertEquals(await product.taxRate("CH"), 7.7);
    await app.db.table("shop_product_tax").insert({ product_id: 10, country: "CH", rate: 2.6 });
    assertEquals(await product.taxRate("CH"), 2.6);

    const ctx = await asVisitor(app, async (ctx) => {
      const order = (await cart(ctx))!;
      await order.add(product);
      assertEquals((await order.extras()).length, 0);
      return ctx;
    });
    // a minimum set meanwhile: the next request of the same visitor sees the surcharge
    await app.db.table("shop_currency").update({ id: "CHF", minimum: 5000, minimum_surcharge: 500 });
    await asVisitor(app, async (ctx) => {
      assertEquals((await (await cart(ctx))!.extras()).map((x) => x.key), ["minimum"]);
    }, ctx);
  });
});

test("an open cart keeps pricing as it was opened, with or without tax", async () => {
  await withShop([], async (app) => {
    await asVisitor(app, async (ctx) => {
      const order = (await cart(ctx))!;
      await app.settings["cms.shop"].taxIncluded(false); // the shop switches, the cart stays gross
      const product = (await app.db.table("shop_product").get<Product>(10))!;
      assertEquals((await product.prices({ order })).gross, 2450);
      assertEquals((await product.prices()).gross, 2450 * 1.081); // no order: the shop's say
    });
  });
});
