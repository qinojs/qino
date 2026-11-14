import { test } from "node:test";
import { assert, assertEquals } from "@qino/qino/tests";

import { asVisitor, withShop } from "../../tests/app.ts";
import { cms as cmsOf } from "@qino/qino/cms";
import { cart, methodStep, shippingMethods } from "@qino/qino/cms.shop";

import type { Product } from "@qino/qino/cms.shop";

test("shipping by weight: the cheapest rate above the parcel, free from an amount", async () => {
  await withShop(["cms.shop.shipping.weight"], async (app) => {
    for (const [weight, price] of [[2000, 900], [10000, 1200]]) {
      await app.db.table("shop_shipping_rate").insert({ country: "CH", method: "a", weight, price });
    }
    await app.db.table("shop_shipping_rate").insert({ country: "DE", method: "b", weight: 2000, price: 1900 });
    await app.settings["cms.shop"].labels["weight.a"].en("PostPac Priority");
    // every tariff there is, whatever the country: what the settings page chooses from
    assertEquals((await shippingMethods(app)).map((m) => m.name), ["weight.a", "weight.b"]);
    const product = (await app.db.table("shop_product").get<Product>(10))!;
    await asVisitor(app, async (ctx) => {
      const order = (await cart(ctx))!;
      const line = await order.add(product, { quantity: 2 });
      assertEquals(await order.shippings(), [{ name: "weight.a", label: "PostPac Priority" }]);
      assertEquals(await order.activeShipping(), "weight.a"); // the only one
      // the checkout step: the method to choose, with what it costs
      const step = String(await methodStep("shipping", { en: "Shipping method" }).render(await cmsOf(app).node(10), { ctx }));
      assert(step.includes("shop-choose=shipping") && step.includes('value="weight.a" checked') && step.includes("CHF 9.00"));
      assertEquals(await order.shippingCost(), 900);
      await line.setQuantity(6);
      assertEquals(await order.shippingCost(), 1200);
      await app.db.table("shop_shipping_free").insert({ country: "CH", method: "a", amount: 10000 });
      assertEquals(await order.shippingCost(), 0);
      assertEquals((await order.extras())[0].key, "shipping");
    });
  });
});
