import { assertEquals, assertRejects } from "@std/assert";
import { invoke } from "@qino/qino";
import { cancel } from "@qino/qino/fin.payment";

import { asUser, users, withFinApp } from "../../tests/app.ts";
import { api } from "../api.ts";
import { assign, ingest } from "../mod.ts";

import type { ApiTree } from "@qino/qino";

const FIN = ["fin.payment", "fin.invoice", "fin.bank", "fin.bank.camt", "fin.accounting", "fin.accounting.ch"];

Deno.test("statements, their lines and the VAT return are a superuser's", async () => {
  await withFinApp(FIN, async (app) => {
    const { anna, boss } = await users(app);
    const [camt, vat] = [app.apiTree["fin.bank.camt"], app.apiTree["fin.accounting.ch"]] as ApiTree[];
    const denied = (fn: () => Promise<unknown>) => assertRejects(() => asUser(app, anna, fn), Error, "Access denied");
    await denied(() => invoke(api, "GET", "/lines"));
    await denied(() => invoke(api, "POST", "/line/1/assign", { ref: "fin.invoice:1" }));
    await denied(() => invoke(camt, "POST", "/", { xml: "<Document/>" }));
    await denied(() => invoke(vat, "GET", "/vat", { from: "2026-01-01", to: "2026-12-31" }));
    assertEquals(await asUser(app, boss, () => invoke(api, "GET", "/lines")), []);
    const report = await asUser(app, boss, () => invoke(vat, "GET", "/vat", { from: "2026-01-01", to: "2026-12-31" }));
    assertEquals((report as { payable: number }).payable, 0);
  });
});

Deno.test("a line assigned by mistake is free again once its payment is canceled", async () => {
  await withFinApp(FIN, async (app) => {
    await ingest(app, {
      account: "CH9300762011623852957", currency: "CHF",
      transactions: [{ id: "a", date: "2026-10-01", amount: 5000 }],
    });
    const tx = Number(await app.db.one`SELECT id FROM bank_tx`);
    const payment = await assign(app, tx, "shop.order:1");
    await cancel(app, payment);
    assertEquals(await app.db.one`SELECT payment_id FROM bank_tx WHERE id = ${tx}`, null);
  });
});
