import { assertEquals, assertRejects } from "@std/assert";
import { create as invoice, issue, refOf } from "@qino/qino/fin.invoice";
import { create, methods, refund } from "@qino/qino/fin.payment";

import { withFinApp } from "../../tests/app.ts";
import { add, balance, moves, payOut } from "../mod.ts";

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

Deno.test("paid out onto credit: an outgoing payment, and the credit it adds, refer to each other", async () => {
  await withFinApp(["fin.payment", "fin.payment.credit"], async (app) => {
    const usr = Number(await app.db.table("usr").insert({ active: 1, pw: "", superuser: 0, family_name: "Muster" }));
    const payment = await payOut(app, usr, { amount: 1500, currency: "CHF", ref: "fin.invoice:9", text: "G2027-1" });
    const row = await app.db.row`SELECT * FROM payment WHERE id = ${payment}`;
    assertEquals(
      [row?.direction, row?.provider, row?.status, row?.paid, row?.ref],
      ["out", "credit", "paid", 1500, "fin.invoice:9"],
    );
    assertEquals(await balance(app, usr, "CHF"), 1500);
    assertEquals((await moves(app, usr)).map((m) => [m.amount, m.text, m.ref]), [[1500, "G2027-1", `fin.payment:${payment}`]]);
  });
});
