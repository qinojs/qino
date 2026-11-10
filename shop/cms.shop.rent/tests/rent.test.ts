import { test } from "node:test";
import { assertEquals } from "@qino/qino/tests";
import { cart } from "@qino/qino/cms.shop";

import { asVisitor, withShop } from "../../tests/app.ts";
import { busy, free, timeSelector } from "../mod.ts";

import type { Order, Product } from "@qino/qino/cms.shop";

const at = (day: number, hour: number) => new Date(2030, 0, day, hour).getTime() / 1000; // 7.1.2030 is a Monday

test("a selector reads weekdays and hours, ranges wrap, a comma lists", () => {
  const monday = new Date(2030, 0, 7, 9), sunday = new Date(2030, 0, 13, 23);
  assertEquals([timeSelector("weekday(monday-friday) hour(8-11)")(monday), timeSelector("weekday(monday-friday)")(sunday)], [true, false]);
  assertEquals([timeSelector("hour(22-7)")(sunday), timeSelector("hour(22-7)")(monday)], [true, false]);
  assertEquals(timeSelector("weekday(saturday, sunday) hour(20-7)")(sunday), true);
});

test("renting: the amount is the hours, the price by the rules, what is taken cannot be taken again", async () => {
  await withShop(["cms.shop.rent"], async (app) => {
    await app.db.table("shop_product").update(10, { price: 10000, rent_interval: "1 hour" });
    await app.db.table("shop_rent_price").insert({ product_id: 10, selector: "hour(8-11)", multiplier: 0.5 });
    await app.db.table("shop_rent_price").insert({ product_id: 10, selector: "hour(22-7)", multiplier: null });
    const product = (await app.db.table("shop_product").get<Product>(10))!;
    const hour = (day: number, h: number) => ({ begin: at(day, h), end: at(day, h) + 3599 });
    let placed: Order | undefined;
    await asVisitor(app, async (ctx) => {
      const order = (await cart(ctx))!;
      const line = await order.add(product, { data: { rent: [hour(7, 9), hour(7, 12)] } });
      assertEquals(Number(line.quantity), 2);
      assertEquals(Number(line.price), 7500); // 50.00 and 100.00 on average
      assertEquals(Object.keys(await line.errors()), []);
      const night = await order.add(product, { data: { rent: [hour(8, 23)] } });
      assertEquals(Object.keys(await night.errors()), ["rent taken"]);
      await night.solve("drop taken");
      await order.setParty("bill", { name: "Anna", address: { addressCountry: "CH" } });
      assertEquals((await order.place()).ok, true);
      assertEquals(Number(await app.db.one`SELECT COUNT(*) FROM shop_rental`), 2);
      placed = order;
    });
    await asVisitor(app, async (ctx) => {
      const order = (await cart(ctx))!;
      const line = await order.add(product, { data: { rent: [hour(7, 9), hour(7, 14)] } });
      assertEquals(Object.keys(await line.errors()), ["rent taken"]);
      await line.solve("drop taken");
      assertEquals([Number(line.quantity), (line.dataOf() as { rent: unknown[] }).rent.length, Object.keys(await line.errors())], [1, 1, []]);
    });
    await placed!.cancel();
    assertEquals(Number(await app.db.one`SELECT COUNT(*) FROM shop_rental`), 0, "canceled: the times are free again");
  });
});

test("a capacity: as many at once as there are, the same time twice in a line is two", async () => {
  await withShop(["cms.shop.rent"], async (app) => {
    await app.db.table("shop_product").update(10, { price: 1000, rent_interval: "1 day", rent_capacity: 3 });
    const product = (await app.db.table("shop_product").get<Product>(10))!;
    const day = { begin: at(7, 0), end: at(8, 0) };
    assertEquals(busy([{ begins: at(6, 0), ends: at(7, 12) }, { begins: at(7, 12), ends: at(9, 0) }], day), 1, "one after the other");
    await asVisitor(app, async (ctx) => {
      const order = (await cart(ctx))!;
      const line = await order.add(product, { data: { rent: [day, day] } });
      assertEquals(Number(line.quantity), 2);
      await order.setParty("bill", { name: "Anna", address: { addressCountry: "CH" } });
      assertEquals((await order.place()).ok, true);
    });
    assertEquals(await free(app, 10, day), 1);
    await asVisitor(app, async (ctx) => {
      const order = (await cart(ctx))!;
      const line = await order.add(product, { data: { rent: [day, day] } });
      assertEquals(Object.keys(await line.errors()), ["rent taken"]);
      await line.solve("drop taken");
      assertEquals(Number(line.quantity), 1, "the one still free");
      // another line for the same time: the first in the cart has it
      const second = await order.add(product, { data: { rent: [day], note: "second" } });
      assertEquals([Object.keys(await line.errors()), Object.keys(await second.errors())], [[], ["rent taken"]]);
    });
  });
});

test("times that are none, too many or begun already are not rented", async () => {
  await withShop(["cms.shop.rent"], async (app) => {
    await app.db.table("shop_product").update(10, { price: 10000, rent_interval: "1 hour" });
    const product = (await app.db.table("shop_product").get<Product>(10))!;
    const begin = at(7, 9);
    await asVisitor(app, async (ctx) => {
      const order = (await cart(ctx))!;
      for (const rent of [[{ begin, end: begin + 36000 }, { begin: begin + 32400, end: begin }], [{ begin: 0, end: 4e10 }], "x"]) {
        const line = await order.add(product, { data: { rent } });
        assertEquals([Number(line.quantity), Object.keys(await line.errors())], [0, ["quantity"]]);
        await order.remove(line);
      }
      const past = await order.add(product, { data: { rent: [{ begin: 3600, end: 7200 }] } });
      assertEquals(Object.keys(await past.errors()), ["rent taken"]);
    });
  });
});
