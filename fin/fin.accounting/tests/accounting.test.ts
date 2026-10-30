import { assertEquals, assertRejects } from "@std/assert";
import { attach, cancel, create, creditNote, finalize, issue, refOf, setSent, update, writeOff } from "@qino/qino/fin.invoice";
import { today } from "@qino/qino/fin";
import { record } from "@qino/qino/fin.payment";

import { withFinApp } from "../../tests/app.ts";
import { balances, book, businessYear, close, reopen, reverse } from "../mod.ts";

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

Deno.test("a recorded payment is booked on the day the money moved, a closed period on today", async () => {
  await withApp(async (app) => {
    const invoice = async () => Number((await issue(app, await create(app, {
      currency: "CHF", date: "2026-03-01", lines: [{ name: "Hosting", price: 24000 }],
    })))?.id);
    const dateOf = (payment: number) => app.db.one`SELECT date FROM accounting_entry WHERE ref = ${`fin.payment:${payment}`}`;
    const first = await record(app, { direction: "in", provider: "bank", amount: 24000, currency: "CHF", ref: refOf(await invoice()), date: "2026-03-20" });
    assertEquals(await dateOf(first), "2026-03-20");
    await app.settings["fin.accounting"].closedUntil("2026-06-30");
    const late = await record(app, { direction: "in", provider: "bank", amount: 24000, currency: "CHF", ref: refOf(await invoice()), date: "2026-04-02" });
    assertEquals(await dateOf(late), today());
    await assertRejects(() => record(app, { direction: "in", provider: "bank", amount: 1, currency: "CHF", date: "2.4.2026" }), Error, "YYYY-MM-DD");
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

Deno.test("the business year runs on from the last closing, any day; without one it is the calendar year", async () => {
  await withApp(async (app) => {
    assertEquals(await businessYear(app, "2027-03-15"), { from: "2027-01-01", to: "2027-12-31" });
    await app.settings["fin.accounting"].closedUntil("2025-06-30");
    assertEquals(await businessYear(app, "2026-03-15"), { from: "2025-07-01", to: "2026-06-30" });
    assertEquals(await businessYear(app, "2027-03-15"), { from: "2026-07-01", to: "2027-06-30" }); // a year not closed yet
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

Deno.test("a pro forma books nothing; the invoice it becomes does", async () => {
  await withApp(async (app) => {
    const lines = [{ name: "Design", price: 100000, taxRate: 8.1 }];
    const id = Number((await issue(app, await create(app, { currency: "CHF", type: "proforma", lines })))?.id);
    assertEquals(await saldo(app), {});
    await finalize(app, id);
    assertEquals(await saldo(app), { "1100": 108100, "2200": -8100, "3400": -100000 });
  });
});

Deno.test("written off: the loss and its tax back; paid after all: taken back again", async () => {
  await withApp(async (app) => {
    const lines = [{ name: "Design", price: 100000, taxRate: 8.1 }, { name: "Book", price: 10000, taxRate: 2.6 }];
    const id = Number((await issue(app, await create(app, { currency: "CHF", date: "2026-10-01", lines })))?.id);
    await record(app, { direction: "in", provider: "bank", amount: 108100, currency: "CHF", ref: refOf(id), date: "2026-10-05" });
    // 102.60 left of 1183.60, shared by the rates as the invoice is: 93.71 at 8.1 % (tax 7.02),
    // 8.89 at 2.6 % (tax 0.23)
    await writeOff(app, id);
    const after = await saldo(app);
    assertEquals([after["1100"], after["3805"], after["2200"]], [undefined, 8669 + 866, -8360 + 702 + 23]);
    // part of it after all: the claim stays settled in the books, the loss with its tax is only what is missing
    await record(app, { direction: "in", provider: "bank", amount: 5000, currency: "CHF", ref: refOf(id), date: "2026-10-15" });
    const part = await saldo(app);
    assertEquals([part["1100"], part["3805"] + part["2200"] + 8360], [undefined, 10260 - 5000]);
    await record(app, { direction: "in", provider: "bank", amount: 5260, currency: "CHF", ref: refOf(id), date: "2026-10-20" });
    const paid = await saldo(app);
    assertEquals([paid["1100"], paid["3805"], paid["2200"]], [undefined, undefined, -8360]);
  });
});

Deno.test("an invoice that went out is canceled by a credit note: booked back in its own period", async () => {
  await withApp(async (app) => {
    const lines = [{ name: "Design", price: 100000, taxRate: 8.1 }];
    const id = Number((await issue(app, await create(app, { currency: "CHF", date: "2026-10-01", lines })))?.id);
    await setSent(app, id, "2026-10-01");
    await cancel(app, id);
    const entries = await app.db.query`SELECT ref, date FROM accounting_entry ORDER BY id`;
    assertEquals(entries.length, 2); // the invoice and its credit note, none reversed
    assertEquals(entries[1].date, today());
    assertEquals(await saldo(app), {});
  });
});
