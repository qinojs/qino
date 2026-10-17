import { assertEquals, assertRejects } from "@std/assert";
import { attach, cancel, create, creditNote, issue, refOf, update } from "@qino/qino/fin.invoice";
import { record } from "@qino/qino/fin.payment";

import { withFinApp } from "../../tests/app.ts";
import { balances, book, close, reopen, reverse } from "../mod.ts";

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
      currency: "CHF", date: "2026-10-01", lines: [{ name: "Design", price: 100000, taxRate: 8.1 }],
    })))?.id);
    assertEquals(await saldo(app), { "1100": 108100, "2200": -8100, "3400": -100000 });
    const payment = await record(app, { direction: "in", provider: "saferpay", amount: 108100, currency: "CHF", paid: 50000, ref: refOf(id) });
    await app.db.exec`UPDATE payment SET paid = 108100, fee = 1500 WHERE id = ${payment}`;
    await app.fire("payment:change", { payment: await app.db.row`SELECT * FROM payment WHERE id = ${payment}` });
    // the provider kept 15.00; the rest is on its account (1091), the claim is settled
    assertEquals(await saldo(app), { "1091": 106600, "2200": -8100, "3400": -100000, "6940": 1500 });
    assertEquals(Number(await app.db.one`SELECT COUNT(*) FROM accounting_entry WHERE ref = ${`fin.payment:${payment}`}`), 2);

    const other = Number((await issue(app, await create(app, { currency: "CHF", lines: [{ name: "Hosting", price: 20000 }] })))?.id);
    await cancel(app, other);
    assertEquals(Number(await app.db.one`SELECT COUNT(*) FROM accounting_entry WHERE ref = ${refOf(other)}`), 2); // booked and reversed
  });
});

Deno.test("a fee without its account books nothing rather than too much money", async () => {
  await withApp(async (app) => {
    await app.settings["fin.accounting"].accounts.fees("");
    const id = Number((await issue(app, await create(app, {
      currency: "CHF", date: "2026-10-01", lines: [{ name: "Design", price: 100000 }],
    })))?.id);
    // the provider reports what arrived and what it kept together
    const payment = await record(app, {
      direction: "in", provider: "saferpay", amount: 100000, currency: "CHF", paid: 0, ref: refOf(id),
    });
    await app.db.exec`UPDATE payment SET paid = 100000, fee = 1500 WHERE id = ${payment}`;
    await app.fire("payment:change", { payment: await app.db.row`SELECT * FROM payment WHERE id = ${payment}` });
    assertEquals(await saldo(app), { "1100": 100000, "3400": -100000 }); // the claim stays open in the books
    // set the account, and the next change books it all
    await app.settings["fin.accounting"].accounts.fees("6940");
    await app.fire("payment:change", { payment: await app.db.row`SELECT * FROM payment WHERE id = ${payment}` });
    assertEquals(await saldo(app), { "1091": 98500, "3400": -100000, "6940": 1500 });
  });
});

Deno.test("a received invoice is a debt, paid from the bank", async () => {
  await withApp(async (app) => {
    const original = await app.dbFiles.add(new File(["%PDF"], "rent.pdf", { type: "application/pdf" }));
    const draft = await create(app, { direction: "in", number: "R-1", currency: "CHF", lines: [{ name: "Rent", price: 180000 }] });
    await attach(app, draft, original);
    const id = Number((await issue(app, draft))?.id);
    // the original is the entry's receipt
    assertEquals(Number(await app.db.one`SELECT f.file_id FROM accounting_entry_file f JOIN accounting_entry e ON e.id = f.entry_id WHERE e.ref = ${refOf(id)}`), original.id);
    await record(app, { direction: "out", provider: "bank", amount: 180000, currency: "CHF", ref: refOf(id) });
    assertEquals(await saldo(app), { "1020": -180000, "4400": 180000 });
  });
});

Deno.test("another currency is left to be booked by hand", async () => {
  await withApp(async (app) => {
    await issue(app, await create(app, { currency: "EUR", lines: [{ name: "Design", price: 100000 }] }));
    assertEquals(await saldo(app), {});
  });
});

Deno.test("an invoice line may name its account; the others book on the default one", async () => {
  await withApp(async (app) => {
    const lines = [
      { name: "Design", price: 100000, taxRate: 8.1 },
      { name: "Book", price: 3990, taxRate: 2.6, account: "3200" },
    ];
    await issue(app, await create(app, { currency: "CHF", date: "2026-10-01", lines }));
    assertEquals(await saldo(app), { "1100": 112194, "2200": -8204, "3200": -3990, "3400": -100000 });
    // prices with tax: the net is split by the rate, and still adds up
    const gross = [
      { name: "Rent", price: 108100, taxRate: 8.1 },
      { name: "Power", price: 10260, taxRate: 2.6, account: "6000" },
    ];
    const bill = { direction: "in" as const, number: "R-9", currency: "CHF", date: "2026-10-02", taxIncluded: true };
    await issue(app, await create(app, { ...bill, lines: gross }));
    const s = await saldo(app);
    assertEquals([s["4400"], s["6000"], s["1170"], s["2000"]], [100000, 10000, 8360, -118360]);
  });
});

Deno.test("closing a year puts its result onto equity, closes the books, and opens again", async () => {
  await withApp(async (app) => {
    const sale = (date: string, amount: number) =>
      book(app, { date, text: "Sale", lines: [{ account: "1020", amount }, { account: "3400", amount: -amount }] });
    await sale("2026-03-01", 50000);
    const rent = [{ account: "6000", amount: 20000 }, { account: "1020", amount: -20000 }];
    await book(app, { date: "2026-04-01", text: "Rent", lines: rent });
    await sale("2027-02-01", 10000);
    await close(app, "2026-12-31");
    assertEquals(await app.settings["fin.accounting"].closedUntil, "2026-12-31");
    // the year still shows its result; the balance sheet has it on equity, and only what follows is open
    const year = { from: "2026-01-01", to: "2026-12-31" };
    assertEquals(await saldo(app, year), { "1020": 30000, "2979": -30000 });
    const shown = Object.fromEntries((await balances(app, { ...year, closings: false }))
      .filter((r) => Number(r.balance)).map((r) => [String(r.number), Number(r.balance)]));
    assertEquals(shown, { "1020": 30000, "3400": -50000, "6000": 20000 });
    await assertRejects(() => close(app, "2026-12-31"), Error, "already");
    await assertRejects(() => sale("2026-12-30", 1), Error, "closed");

    await reopen(app);
    assertEquals(await app.settings["fin.accounting"].closedUntil, "");
    assertEquals((await saldo(app, year))["2979"], undefined);
    await sale("2026-12-30", 1); // open again
  });
});

Deno.test("a credit note books revenue and tax back; paying it back books the money out", async () => {
  await withApp(async (app) => {
    const lines = [{ name: "Design", price: 100000, taxRate: 8.1 }];
    const id = Number((await issue(app, await create(app, { currency: "CHF", date: "2026-10-01", lines })))?.id);
    await record(app, { direction: "in", provider: "bank", amount: 108100, currency: "CHF", ref: refOf(id) });
    const note = await creditNote(app, id);
    await update(app, note, { lines: [{ name: "Design", quantity: -1, price: 20000, taxRate: 8.1 }] });
    await issue(app, note);
    // revenue and tax less the credit; the customer is owed it
    assertEquals(await saldo(app), { "1020": 108100, "1100": -21620, "2200": -6480, "3400": -80000 });
    await record(app, { direction: "out", provider: "bank", amount: 21620, currency: "CHF", ref: refOf(note) });
    assertEquals(await saldo(app), { "1020": 86480, "2200": -6480, "3400": -80000 });
  });
});
