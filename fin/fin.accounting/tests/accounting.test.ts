import { assertEquals, assertRejects } from "@std/assert";
import { cancel, create, issue, refOf } from "@qino/qino/fin.invoice";
import { record } from "@qino/qino/fin.payment";

import { withFinApp } from "../../tests/app.ts";
import { balances, book, reverse } from "../mod.ts";

import type { App } from "@qino/qino";

const withApp = (fn: (app: App) => Promise<void>) =>
  withFinApp(["fin.payment", "fin.invoice", "fin.accounting", "fin.accounting.ch"], fn);

/** Balance per account number, only those with something on them. */
async function saldo(app: App, period: { from?: string; to?: string } = {}) {
  const rows = await balances(app, period);
  return Object.fromEntries(rows.filter((r) => Number(r.balance)).map((r) => [String(r.number), Number(r.balance)]));
}

Deno.test("an entry adds up to zero, names known accounts, and stays out of closed periods", async () => {
  await withApp(async (app) => {
    const rent = { date: "2026-10-07", text: "Rent", lines: [{ account: "6000", amount: 1000 }, { account: "1020", amount: -1000 }] };
    await book(app, rent);
    await assertRejects(() => book(app, { ...rent, lines: [{ account: "6000", amount: 1000 }, { account: "1020", amount: -900 }] }), Error, "zero");
    await assertRejects(() => book(app, { ...rent, lines: [{ account: "6000", amount: 1 }, { account: "9999", amount: -1 }] }), Error, "9999");
    await assertRejects(() => book(app, { ...rent, date: "7.10.2026" }), Error, "YYYY");
    await app.settings["fin.accounting"].closedUntil("2026-09-30");
    await assertRejects(() => book(app, { ...rent, date: "2026-09-30" }), Error, "closed");
    assertEquals(await saldo(app), { "1020": -1000, "6000": 1000 });
  });
});

Deno.test("a reversal takes an entry back, once", async () => {
  await withApp(async (app) => {
    const id = await book(app, { date: "2026-10-07", text: "Wrong", lines: [{ account: "6500", amount: 500 }, { account: "1000", amount: -500 }] });
    await reverse(app, id, { date: "2026-10-08" });
    assertEquals(await saldo(app), {});
    await assertRejects(() => reverse(app, id), Error, "already");
  });
});

Deno.test("the balance sheet sums all time, the result only the period", async () => {
  await withApp(async (app) => {
    await book(app, { date: "2025-12-15", text: "Sale 2025", lines: [{ account: "1020", amount: 300 }, { account: "3400", amount: -300 }] });
    await book(app, { date: "2026-02-01", text: "Sale 2026", lines: [{ account: "1020", amount: 200 }, { account: "3400", amount: -200 }] });
    assertEquals(await saldo(app, { from: "2026-01-01", to: "2026-12-31" }), { "1020": 500, "3400": -200 });
    assertEquals(await saldo(app, { to: "2025-12-31" }), { "1020": 300, "3400": -300 });
  });
});

Deno.test("invoices and their payments book themselves, in parts, with fees, and a cancel takes it back", async () => {
  await withApp(async (app) => {
    const id = Number((await issue(app, await create(app, {
      currency: "CHF", date: "2026-10-01", lines: [{ title: "Design", price: 100000, taxRate: 8.1 }],
    })))?.id);
    assertEquals(await saldo(app), { "1100": 108100, "2200": -8100, "3400": -100000 });
    const payment = await record(app, { direction: "in", provider: "saferpay", amount: 108100, currency: "CHF", paid: 50000, ref: refOf(id) });
    await app.db.exec`UPDATE payment SET paid = 108100, fee = 1500 WHERE id = ${payment}`;
    await app.fire("payment:change", { payment: await app.db.row`SELECT * FROM payment WHERE id = ${payment}` });
    // the provider kept 15.00; the rest is on its account (1091), the claim is settled
    assertEquals(await saldo(app), { "1091": 106600, "2200": -8100, "3400": -100000, "6940": 1500 });
    assertEquals(Number(await app.db.one`SELECT COUNT(*) FROM entry WHERE ref = ${`fin.payment:${payment}`}`), 2);

    const other = Number((await issue(app, await create(app, { currency: "CHF", lines: [{ title: "Hosting", price: 20000 }] })))?.id);
    await cancel(app, other);
    assertEquals(Number(await app.db.one`SELECT COUNT(*) FROM entry WHERE ref = ${refOf(other)}`), 2); // booked and reversed
  });
});

Deno.test("a received invoice is a debt, paid from the bank", async () => {
  await withApp(async (app) => {
    const id = Number((await issue(app, await create(app, {
      direction: "in", number: "R-1", currency: "CHF", lines: [{ title: "Rent", price: 180000 }],
    })))?.id);
    await record(app, { direction: "out", provider: "bank", amount: 180000, currency: "CHF", ref: refOf(id) });
    assertEquals(await saldo(app), { "1020": -180000, "4400": 180000 });
  });
});

Deno.test("another currency is left to be booked by hand", async () => {
  await withApp(async (app) => {
    await issue(app, await create(app, { currency: "EUR", lines: [{ title: "Design", price: 100000 }] }));
    assertEquals(await saldo(app), {});
  });
});
