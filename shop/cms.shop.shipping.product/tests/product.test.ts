import { test } from "node:test";
import { assertEquals } from "@qino/qino/tests";
import { cart } from "@qino/qino/cms.shop";

import { asVisitor, withShop } from "../../tests/app.ts";

import type { Product } from "@qino/qino/cms.shop";

test("shipping by the products: each line the rate of the step its amount reaches, summed", async () => {
  await withShop(["cms.shop.shipping.product"], async (app) => {
    const product = (await app.db.table("shop_product").get<Product>(10))!;
    await asVisitor(app, async (ctx) => {
      const order = (await cart(ctx))!;
      const line = await order.add(product, { quantity: 50 });
      assertEquals(await order.shippings(), [], "no rates: not offered");
      for (const [min_quantity, price] of [[1, 700], [100, 900], [500, 1500]]) {
        await app.db.table("shop_shipping_product").insert({ product_id: 10, min_quantity, price });
      }
      order.forget();
      assertEquals((await order.shippings()).map((m) => m.name), ["product"]);
      assertEquals(await order.shippingCost(), 700);
      await line.setQuantity(500);
      assertEquals(await order.shippingCost(), 1500);
    });
  });
});
