import { test } from "node:test";
import { assertEquals } from "@qino/qino/tests";

import { asVisitor, withShop } from "../../tests/app.ts";
import { cart } from "../../cms.shop/mod.ts";

import type { Product } from "../../cms.shop/mod.ts";

test("goods below the minimum add a surcharge, excluded nodes do not count", async () => {
  await withShop(["cms.shop.minimum"], async (app) => {
    await app.db.table("shop_currency").update({ id: "CHF", minimum: 12000, minimum_surcharge: 1500 });
    const product = (await app.db.table("shop_product").get<Product>(10))!;
    await asVisitor(app, async (ctx) => {
      const order = (await cart(ctx))!;
      const line = await order.add(product, { quantity: 2 });
      assertEquals((await order.extras()).map((x) => [x.key, x.price, x.taxRate]), [["minimum", 1500, 8.1]]);
      await line.setQuantity(5);
      assertEquals(await order.extras(), []);
      await app.settings["cms.shop.minimum"].exclude("10");
      await order.reprice();
      assertEquals(await order.extras(), []); // nothing counts: no goods, no surcharge
    });
  });
});
