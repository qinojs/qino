import { test } from "node:test";
import { assertEquals } from "@qino/qino/tests";

import { asVisitor, withShop } from "../../tests/app.ts";
import { cart } from "@qino/qino/cms.shop";

import type { Product } from "@qino/qino/cms.shop";

test("stock blocks what is not there and is taken off when ordered", async () => {
  await withShop(["cms.shop.stock"], async (app) => {
    const product = (await app.db.table("shop_product").get<Product>(10))!;
    await asVisitor(app, async (ctx) => {
      assertEquals(Object.keys(await product.errors()), ["out of stock"]);
      const variant = await app.db.table("shop_variant").insert({ product_id: 10, stock: 2 });
      assertEquals(Object.keys(await product.errors()), []); // in stock as its variants are
      const order = (await cart(ctx))!;
      const line = await order.add(product, { variant: await product.variant(variant), quantity: 3 });
      assertEquals(Object.keys(await line.errors()), ["out of stock"]);
      assertEquals(await line.solve("nothing"), false);
      assertEquals(await line.solve("set quantity"), true); // the way out it offers: what is left
      assertEquals(Number(line.quantity), 2);
      assertEquals(Object.keys(await line.solutions()), []);
      await order.setParty("bill", { name: "Anna", address: { addressCountry: "CH" } });
      assertEquals((await order.place()).ok, true);
      assertEquals(Number((await product.variant(variant))!.$get("stock")), 0);
    });
  });
});
