import { test } from "node:test";
import { assertEquals, testContext } from "@qino/qino/tests";

import { asVisitor, withShop } from "../../tests/app.ts";
import { calendar } from "../calendar.ts";

test("rental calendar returns occupied intervals, with exclusive ends and owner access", async () => {
  await withShop(["cms.shop.rent"], async (app) => {
    const users = app.db.table("usr");
    const owner = Number(await users.insert({ username: "renter" }));
    const other = Number(await users.insert({ username: "other" }));
    const admin = Number(await users.insert({ username: "admin", superuser: true }));
    const period = { start: "2027-07-12T00:00:00Z", end: "2027-07-14T00:00:00Z", timeZone: "UTC" };
    const begins = Date.parse("2027-07-12T13:00:00Z") / 1000, ends = Date.parse("2027-07-13T07:00:00Z") / 1000;
    for (const usr_id of [owner, other]) await app.db.table("shop_rental").insert({ product_id: 10, usr_id, begins, ends, name: "Reservation" });
    await app.db.table("shop_rental").insert({ product_id: 10, usr_id: owner, begins: Date.parse(period.end) / 1000, ends: Date.parse(period.end) / 1000 + 3600 });
    const read = async (userId: number) => {
      const ctx = await testContext({ app, userId, set: { app } });
      return asVisitor(app, () => calendar.query(ctx, period), ctx);
    };
    const own = await read(owner);
    assertEquals(own.length, 1);
    assertEquals([own[0].start, own[0].end], ["2027-07-12T13:00:00Z", "2027-07-13T07:00:00Z"]);
    assertEquals((await read(other)).length, 1);
    assertEquals((await read(admin)).length, 2);
    assertEquals(await read(0), []);
  });
});
