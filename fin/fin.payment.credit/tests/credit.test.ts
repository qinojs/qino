import { assertEquals, assertRejects } from "@std/assert";
import { create as invoice, issue, refOf } from "@qino/qino/fin.invoice";
import { create, methods, refund } from "@qino/qino/fin.payment";

import { withFinApp } from "../../tests/app.ts";
import { add, balance } from "../mod.ts";

Deno.test("credit is added, pays an invoice where it covers it, and comes back with a refund", async () => {
  await withFinApp(["fin.payment", "fin.invoice", "fin.payment.credit"], async (app) => {
    const usr = Number(await app.db.table("usr").insert({
      active: 1, pw: "", superuser: 0, given_name: "Anna", family_name: "Muster",
    }));
    await add(app, usr, { amount: 5000, currency: "CHF", text: "Goodwill" });
    await assertRejects(() => add(app, usr, { amount: -6000, currency: "CHF" }), Error, "not enough");
    const offer = { amount: 3000, currency: "CHF", usrId: usr };
    assertEquals((await methods(app, offer)).map((m) => m.method), ["credit"]);
    assertEquals(await methods(app, { ...offer, amount: 6000 }), []); // does not cover it
    assertEquals(await methods(app, { ...offer, usrId: undefined }), []); // nobody's

    const id = Number((await issue(app, await invoice(app, {
      currency: "CHF", usrId: usr, lines: [{ name: "Design", price: 3000 }],
    })))?.id);
    const { id: payment } = await create(app, { ...offer, method: "credit", ref: refOf(id), return: "/" });
    assertEquals(await balance(app, usr, "CHF"), 2000);
    assertEquals((await app.db.row`SELECT status FROM invoice WHERE id = ${id}`)?.status, "paid");

    await refund(app, payment, 1000);
    assertEquals(await balance(app, usr, "CHF"), 3000);
  });
});
