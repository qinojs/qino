import { test } from "node:test";
import { assertEquals } from "@qino/qino/tests";

import { asVisitor, withShop } from "../../tests/app.ts";
import { cart } from "@qino/qino/cms.shop";

import type { Product } from "@qino/qino/cms.shop";

test("shipping by weight: the cheapest rate above the parcel, free from an amount", async () => {
  await withShop(["cms.shop.shipping.weight"], async (app) => {
    for (const [weight, price] of [[2000, 900], [10000, 1200]]) {
      await app.db.table("shop_shipping_rate").insert({ country: "CH", method: "a", weight, price });
    }
    await app.settings["cms.shop"].labels["weight.a"].en("PostPac Priority");
    const product = (await app.db.table("shop_product").get<Product>(10))!;
    await asVisitor(app, async (ctx) => {
      const order = (await cart(ctx))!;
      const line = await order.add(product, { quantity: 2 });
      assertEquals(await order.shippings(), [{ name: "weight.a", label: "PostPac Priority" }]);
      assertEquals(await order.activeShipping(), "weight.a"); // the only one
      assertEquals(await order.shippingCost(), 900);
      await line.setQuantity(6);
      assertEquals(await order.shippingCost(), 1200);
      await app.db.table("shop_shipping_free").insert({ country: "CH", method: "a", amount: 10000 });
      assertEquals(await order.shippingCost(), 0);
      assertEquals((await order.extras())[0].key, "shipping");
    });
  });
});
