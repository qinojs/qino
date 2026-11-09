import { test } from "node:test";
import { assertEquals } from "@qino/qino/tests";
import { cms } from "@qino/qino/cms";
import { cart } from "@qino/qino/cms.shop";

import { asVisitor, withShop } from "../../tests/app.ts";

import type { Product } from "@qino/qino/cms.shop";

test("a week of times: closed ones are no row, booked ones say so, the visitor's own are marked", async () => {
  await withShop(["cms.shop.rent", "cms.cont.shop.rent"], async (app) => {
    await app.db.table("page").update(10, { module: "cms.cont.shop.rent" });
    await app.db.table("shop_product").update(10, { price: 1000, rent_interval: "1 hour", rent_capacity: 2 });
    await app.db.table("shop_rent_price").insert({ product_id: 10, selector: "hour(0-7, 20-23)", multiplier: null });
    await app.db.table("shop_rent_price").insert({ product_id: 10, selector: "hour(18-19)", multiplier: 1.5 });
    const monday = new Date(); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7 + 7);
    const at = (day: number, hour: number) => monday.getTime() / 1000 + day * 86400 + hour * 3600;
    const hour = (day: number, h: number) => ({ begin: at(day, h), end: at(day, h) + 3600 });
    for (const _ of [1, 2]) await app.db.table("shop_rental").insert({ product_id: 10, begins: at(1, 9), ends: at(1, 10) });
    await asVisitor(app, async (ctx) => {
      const order = (await cart(ctx))!;
      await order.add((await app.db.table("shop_product").get<Product>(10))!, { data: { rent: [hour(2, 10)] } });
      const out = String(await (await cms(app).node(10)).html({ week: 1 }));
      const rows = out.match(/<tr>/g)!.length - 1; // less the head
      assertEquals(rows, 12, "8 to 19 o'clock");
      const count = (text: string) => out.split(text).length - 1;
      assertEquals([count(">Booked<"), count("class=-mine"), count("2 free")], [1, 1, 7 * 12 - 2]);
      assertEquals(count("CHF 15.00"), 7 * 2, "the evening at 1.5");
    });
  });
});
