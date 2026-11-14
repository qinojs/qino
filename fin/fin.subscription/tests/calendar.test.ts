import { test } from "node:test";
import { getCtx } from "@qino/qino";
import { assertEquals, testContext } from "@qino/qino/tests";

import { asUser, users, withFinApp } from "../../tests/app.ts";
import { subscribe } from "../mod.ts";
import { calendar } from "../calendar.ts";

test("subscription calendar projects bounded renewal dates without billing and keeps owner access", async () => {
  await withFinApp(["fin.payment", "fin.invoice", "fin.subscription"], async (app) => {
    const { anna, ben, boss } = await users(app);
    await subscribe(app, { usrId: anna, name: "Monthly", price: 100, currency: "CHF", unit: "month", start: "2027-01-31", end: "2027-04-01" });
    await subscribe(app, { usrId: ben, name: "Private", price: 100, currency: "CHF", unit: "month", start: "2027-01-15" });
    const period = { start: "2027-01-01T00:00:00Z", end: "2027-04-02T00:00:00Z", timeZone: "UTC" };
    const read = () => calendar.query(getCtx(), period);
    const own = await asUser(app, anna, read);
    assertEquals(own.map((item) => item.start), ["2027-01-31", "2027-02-28", "2027-03-31"]);
    assertEquals(own.map((item) => item.end), ["2027-02-01", "2027-03-01", "2027-04-01"]);
    assertEquals((await asUser(app, ben, read)).length, 3);
    assertEquals((await asUser(app, boss, read)).length, 6);
    assertEquals(await calendar.query(await testContext({ app }), period), []);
    assertEquals(await app.db.one`SELECT COUNT(*) FROM subscription_invoice`, 0);
    const later = { ...period, start: "2027-03-01T00:00:00Z" };
    assertEquals((await asUser(app, anna, () => calendar.query(getCtx(), later)))[0].id, own[2].id);
  });
});
