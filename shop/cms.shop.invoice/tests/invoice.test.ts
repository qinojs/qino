import { test } from "node:test";
import { assertEquals } from "@qino/qino/tests";
import { record } from "@qino/qino/fin.payment";

import { asVisitor, withShop } from "../../tests/app.ts";
import { cart } from "@qino/qino/cms.shop";

import type { Product } from "@qino/qino/cms.shop";

test("a placed order is invoiced one to one, the paid invoice pays the order", async () => {
  await withShop(["cms.shop.invoice"], async (app) => {
    const product = (await app.db.table("shop_product").get<Product>(10))!;
    await asVisitor(app, async (ctx) => {
      const order = (await cart(ctx))!;
      await order.add(product, { quantity: 2 });
      await order.setParty("bill", { name: "Anna Muster", address: { addressCountry: "CH" } });
      assertEquals((await order.place()).ok, true);
      const invoice = (await app.db.row`SELECT * FROM invoice WHERE ref = ${"cms.shop:" + order.$id}`)!;
      assertEquals([invoice.status, Number(invoice.total)], ["open", 4900]);
      await record(app, { direction: "in", provider: "cash", amount: 4900, currency: "CHF", ref: `fin.invoice:${invoice.id}` });
      assertEquals(order.status, "paid");
    });
  });
});
