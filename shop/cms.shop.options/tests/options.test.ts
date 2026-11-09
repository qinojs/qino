import { test } from "node:test";
import { assertEquals } from "@qino/qino/tests";

import { asVisitor, withShop } from "../../tests/app.ts";
import { cart } from "@qino/qino/cms.shop";

import type { Product } from "@qino/qino/cms.shop";

test("a picked value costs on top, per unit or per line; every option has to be picked", async () => {
  await withShop(["cms.shop.options"], async (app) => {
    const product = (await app.db.table("shop_product").get<Product>(10))!;
    await app.db.table("shop_option").insert({ product_id: 10, name: "Box" });
    await app.db.table("shop_option_value").insert({ product_id: 10, name: "Box", value: "yes", price: 80 });
    await app.db.table("shop_option_value").insert({ product_id: 10, name: "Box", value: "engraved", price: 500, per_line: true });
    await asVisitor(app, async (ctx) => {
      const order = (await cart(ctx))!;
      assertEquals(String((await product.fields({})).join("")).includes('name="options[Box]"'), true);
      const none = await order.add(product);
      assertEquals(Object.keys(await none.errors()), ["option Box"]);
      await order.remove(none);
      const yes = await order.add(product, { quantity: 2, data: { options: { Box: "yes" } } });
      assertEquals(Number(yes.price), 2530);
      assertEquals(await yes.describe(), "Box: yes");
      assertEquals(Object.keys(await yes.errors()), []);
      const engraved = await order.add(product, { quantity: 2, data: { options: { Box: "engraved" } } });
      assertEquals(Number(engraved.price), 2700); // 24.50 + 5.00 / 2
      const wrong = await order.add(product, { data: { options: { Box: "gold" } } });
      assertEquals(Object.keys(await wrong.errors()), ["option Box"]);
    });
  });
});
