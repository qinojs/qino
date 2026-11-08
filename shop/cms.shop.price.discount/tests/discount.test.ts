import { test } from "node:test";
import { assertEquals } from "@qino/qino/tests";

import { asVisitor, withShop } from "../../tests/app.ts";
import { cart } from "../../cms.shop/mod.ts";

import type { App } from "@qino/qino";
import type { Product } from "../../cms.shop/mod.ts";

/** A range (page 20) with two colours (10 and 11). */
async function range(app: App) {
  await app.db.table("page").insert({ id: 20, name: "Range", access: 1 });
  await app.db.exec`UPDATE page SET basis = ${20} WHERE id = ${10}`;
  await app.db.table("page").insert({ id: 11, name: "Blue", access: 1, basis: 20 });
  await app.db.table("shop_product").insert({ id: 11, price: 1000 });
  const product = async (id: number) => (await app.db.table("shop_product").get<Product>(id))!;
  return { red: await product(10), blue: await product(11) };
}

test("a quantity discount counts all lines below its node together", async () => {
  await withShop(["cms.shop.price.discount"], async (app) => {
    const { red, blue } = await range(app);
    await app.db.table("shop_discount").insert({ node_id: 20, min_quantity: 3, factor: 0.9 });
    await asVisitor(app, async (ctx) => {
      const order = (await cart(ctx))!;
      await order.add(red, { quantity: 2 });
      assertEquals((await order.lines())[0].price, 2450);
      await order.add(blue, { quantity: 1 }); // three of the range: both lines are reduced
      assertEquals((await order.lines()).map((l) => l.price), [2205, 900]);
    });
  });
});

test("discounts never add up — the best one wins, a group's only for its members", async () => {
  await withShop(["cms.shop.price.discount"], async (app) => {
    const { red } = await range(app);
    await app.db.table("shop_discount").insert({ node_id: 20, factor: 0.8, title: "Action" });
    await app.db.table("shop_discount").insert({ node_id: 0, grp_id: 5, factor: 0.7 });
    await app.db.table("shop_discount").insert({ node_id: 10, min_quantity: 2, factor: 0.95 });
    assertEquals((await red.prices({ quantity: 2 })).price, 1960); // 0.8, rounded to 0.05
    await app.db.table("usr").insert({ id: 7 });
    await app.db.table("usr_grp").insert({ usr_id: 7, grp_id: 5 });
    assertEquals((await red.prices({ quantity: 2, usrId: 7 })).price, 1715); // the dealer's 0.7 alone
    await app.db.table("shop_discount").update({ id: 1, end: 1 }); // the action is over
    assertEquals((await red.prices({ quantity: 2 })).price, 2330); // 2327.5 on the 0.05 step
  });
});
