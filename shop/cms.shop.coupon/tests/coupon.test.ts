import { test } from "node:test";
import { assertEquals } from "@qino/qino/tests";
import { cart } from "@qino/qino/cms.shop";

import { asVisitor, withShop } from "../../tests/app.ts";
import type {} from "../plugin.ts"; // its column on the order

import type { Order, Product } from "@qino/qino/cms.shop";

const off = async (order: Order) => (await order.extras()).find((x) => x.key === "coupon")?.price;
const redeem = (order: Order, code: string) => { order.coupon = code; order.forget(); };

test("a percentage of the regular prices, an amount up to the order's cost, used up by paying", async () => {
  await withShop(["cms.shop.coupon"], async (app) => {
    const table = app.db.table("shop_coupon"), now = Math.floor(Date.now() / 1000);
    await table.insert({ code: "TEN", title: "10", type: "percent", value: 10 });
    await table.insert({ code: "FIVE", title: "5", type: "money", value: 5 });
    await table.insert({ code: "BIG", title: "99", type: "money", value: 99, constant: true });
    await table.insert({ code: "OLD", title: "old", type: "percent", value: 50, end: now - 3 * 86400 });
    await table.insert({ code: "ONCE", title: "once", type: "percent", value: 10, once: true });
    const product = (await app.db.table("shop_product").get<Product>(10))!;
    const anna = { name: "Anna", email: "anna@example.test", address: { addressCountry: "CH" } };
    let once: Order | undefined;
    await asVisitor(app, async (ctx) => {
      const order = (await cart(ctx))!;
      await order.add(product);
      redeem(order, "TEN");
      assertEquals(await off(order), -245);
      redeem(order, "BIG");
      assertEquals(await off(order), -2450, "not more than it costs");
      redeem(order, "OLD");
      assertEquals(await off(order), undefined);
      redeem(order, "FIVE");
      assertEquals(await off(order), -500);
      await order.setParty("bill", anna);
      assertEquals((await order.place()).ok, true);
      assertEquals(Number(await app.db.one`SELECT value FROM shop_coupon WHERE code = ${"FIVE"}`), 0);
      await order.cancel();
      assertEquals(Number(await app.db.one`SELECT value FROM shop_coupon WHERE code = ${"FIVE"}`), 5, "canceled: the amount is back");
    });
    await asVisitor(app, async (ctx) => {
      const order = (await cart(ctx))!;
      await order.add(product);
      await order.setParty("bill", anna);
      redeem(order, "ONCE");
      assertEquals(await off(order), -245);
      await order.place();
      once = order;
    });
    await asVisitor(app, async (ctx) => {
      const order = (await cart(ctx))!;
      await order.add(product);
      await order.setParty("bill", anna);
      redeem(order, "ONCE");
      assertEquals(await off(order), undefined, "the same email has used it");
    });
    await once!.cancel();
    await asVisitor(app, async (ctx) => {
      const order = (await cart(ctx))!;
      await order.add(product);
      await order.setParty("bill", anna);
      redeem(order, "ONCE");
      assertEquals(await off(order), -245, "a canceled order did not use it");
    });
  });
});
