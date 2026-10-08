import { assertEquals, assertRejects } from "@std/assert";
import { Db } from "@qino/qino";
import { addDays, today } from "@qino/qino/fin";
import { record } from "@qino/qino/fin.payment";
import { fakeSettings, paymentDbSchema } from "@qino/qino/tests";

import dbSchema from "../dbschema.json" with { type: "json" };
import { totals } from "../lib/totals.ts";
import { cancel, create, creditNote, issue, lines, refOf, remove, revise, update } from "../mod.ts";
import { init } from "../plugin.ts";

import type { App, Row } from "@qino/qino";

/** An app with payments and invoices; events reach the listeners, `events` keeps invoice changes. */
async function setup(settings: Record<string, unknown> = {}) {
  const db = new Db("sqlite::memory:");
  const schema = { properties: { ...paymentDbSchema.properties, ...dbSchema.properties } };
  await db.migrate(schema);
  await db.exec`CREATE TABLE usr (id INTEGER PRIMARY KEY AUTOINCREMENT)`;
  db.schema = schema; // as the app does: what hangs on what, for deletes to cascade
  await db.loadTables();
  const listeners: Record<string, ((data: unknown) => unknown)[]> = {};
  const events: { invoice: Row; previous: string }[] = [];
  const app = {
    db,
    settings: fakeSettings({ "fin.invoice": settings }),
    modules: { linked: () => [] },
    languages: { def: "de" },
    on: (name: string, fn: (data: unknown) => unknown) => void (listeners[name] ??= []).push(fn),
    fire: async (name: string, data: { invoice: Row; previous: string }) => {
      if (name === "invoice:status") events.push(data);
      for (const fn of listeners[name] ?? []) await fn(data);
      return data;
    },
  } as unknown as App;
  init(app, { signal: new AbortController().signal });
  return { app, events };
}

const row = (app: App, id: number) => app.db.row`SELECT * FROM invoice WHERE id = ${id}`;

const order = {
  currency: "CHF",
  lines: [
    { name: "Design", quantity: 2.5, unit: "h", price: 12000, taxRate: 8.1 },
    { name: "Hosting", price: 9900, taxRate: 8.1 },
    { name: "Book", price: 3990, taxRate: 2.6 },
  ],
};

Deno.test("tax is rounded once per rate; gross prices have it taken out", () => {
  assertEquals(totals(order.lines, false), {
    amounts: [30000, 9900, 3990],
    rates: [{ rate: 2.6, net: 3990, tax: 104 }, { rate: 8.1, net: 39900, tax: 3232 }],
    net: 43890,
    tax: 3336,
    total: 47226,
  });
  // 39900 incl. 8.1% → 2990 tax, 3990 incl. 2.6% → 101 tax
  const gross = totals(order.lines, true);
  assertEquals(gross.rates, [{ rate: 2.6, net: 3889, tax: 101 }, { rate: 8.1, net: 36910, tax: 2990 }]);
  assertEquals([gross.net, gross.tax, gross.total], [40799, 3091, 43890]);
});

Deno.test("a unit price finer than a minor unit rounds only in the line amount", () => {
  const power = [{ name: "Power", quantity: 1234, unit: "kWh", price: 23.45, taxRate: 8.1 }]; // 0.2345 CHF/kWh
  const sum = totals(power, false);
  assertEquals([sum.amounts, sum.net, sum.tax, sum.total], [[28937], 28937, 2344, 31281]);
});

Deno.test("a draft stores its lines and totals and can be changed until issued", async () => {
  const { app } = await setup();
  const id = await create(app, { ...order, party: { name: "Muster AG", country: "CH" }, ref: "shop.order:3" });
  assertEquals((await lines(app, id)).map((l) => [l.name, l.quantity, l.unit, l.amount]), [
    ["Design", 2.5, "h", 30000],
    ["Hosting", 1, null, 9900],
    ["Book", 1, null, 3990],
  ]);
  let invoice = await row(app, id);
  assertEquals([invoice?.status, invoice?.direction, invoice?.total, invoice?.number], ["draft", "out", 47226, null]);
  assertEquals(invoice?.lang, "de"); // outside a request: the app's default language
  assertEquals(JSON.parse(String(invoice?.party)).name, "Muster AG");
  await update(app, id, { taxIncluded: true });
  assertEquals((await row(app, id))?.total, 43890); // the same lines, now with tax included
  await update(app, id, { lines: [{ name: "Flat", price: 10000 }] });
  invoice = await row(app, id);
  assertEquals([invoice?.net, invoice?.tax, invoice?.total, (await lines(app, id)).length], [10000, 0, 10000, 1]);
  await issue(app, id);
  await assertRejects(() => update(app, id, { text: "Too late" }), Error, "only drafts");
});

Deno.test("issuing draws gapless numbers per year and sets date, due and term", async () => {
  const { app, events } = await setup({ number: "R{year}-{n}", term: 10 });
  const ids = [
    await create(app, { ...order, date: "2026-12-30" }),
    await create(app, { ...order, date: "2026-12-31", term: 20 }),
    await create(app, { ...order, date: "2027-01-02", due: "2027-03-01" }),
  ];
  for (const id of ids) await issue(app, id);
  const issued = await Promise.all(ids.map((id) => row(app, id)));
  // the term of the invoice, else the default, is kept to be printed; a given due date stands
  assertEquals(issued.map((i) => [i?.number, i?.date, i?.due, i?.term, i?.status]), [
    ["R2026-1", "2026-12-30", "2027-01-09", 10, "open"],
    ["R2026-2", "2026-12-31", "2027-01-20", 20, "open"],
    ["R2027-1", "2027-01-02", "2027-03-01", null, "open"],
  ]);
  assertEquals(events.map((e) => [e.invoice.id, e.previous]), ids.map((id) => [id, "draft"]));
  await assertRejects(() => issue(app, ids[0]), Error, "only drafts");
});

Deno.test("a draft's date and due date can be cleared again: issuing then sets them", async () => {
  const { app } = await setup({ term: 10 });
  const id = await create(app, { ...order, date: "2027-01-02", due: "2027-03-01" });
  await update(app, id, { date: null, due: null });
  assertEquals([(await row(app, id))?.date, (await row(app, id))?.due], [null, null]);
  const issued = await issue(app, id);
  assertEquals([issued?.date, issued?.due, issued?.term], [today(), addDays(today(), 10), 10]);
});

Deno.test("an issued invoice without a date is dated today, and numbers default to {year}-{n}", async () => {
  const { app } = await setup();
  const invoice = await issue(app, await create(app, order));
  assertEquals([invoice?.date, invoice?.number], [today(), `${today().slice(0, 4)}-1`]);
});

Deno.test("payments with its ref settle it, partly and fully; a refund reopens it", async () => {
  const { app, events } = await setup();
  const id = await issue(app, await create(app, order)).then((i) => Number(i?.id));
  const pay = (amount: number) =>
    record(app, { direction: "in", provider: "bank", amount, currency: "CHF", ref: refOf(id) });
  await pay(20000);
  assertEquals([(await row(app, id))?.paid, (await row(app, id))?.status], [20000, "open"]);
  const rest = await pay(27226);
  assertEquals([(await row(app, id))?.paid, (await row(app, id))?.status], [47226, "paid"]);
  // money the other way, or for something else, does not count
  await record(app, { direction: "out", provider: "bank", amount: 500, currency: "CHF", ref: refOf(id) });
  await record(app, { direction: "in", provider: "bank", amount: 500, currency: "CHF", ref: "shop.order:1" });
  assertEquals((await row(app, id))?.paid, 47226);
  await app.db.exec`UPDATE payment SET refunded = 1000, status = 'paid' WHERE id = ${rest}`;
  await app.fire("payment:change", { payment: await app.db.row`SELECT * FROM payment WHERE id = ${rest}` });
  assertEquals([(await row(app, id))?.paid, (await row(app, id))?.status], [46226, "open"]);
  assertEquals(events.slice(1).map((e) => [e.invoice.status, e.previous]), [["paid", "open"], ["open", "paid"]]);
});

Deno.test("a received invoice keeps the sender's number and is settled by outgoing money", async () => {
  const { app } = await setup();
  const party = { name: "Supplier", iban: "CH93…" };
  const id = await create(app, { ...order, direction: "in", number: "INV-778", party });
  await issue(app, id);
  await record(app, { direction: "out", provider: "bank", amount: 47226, currency: "CHF", ref: refOf(id) });
  const invoice = await row(app, id);
  assertEquals([invoice?.number, invoice?.status, invoice?.paid], ["INV-778", "paid", 47226]);
});

Deno.test("a canceled invoice stays canceled, whatever is paid", async () => {
  const { app } = await setup();
  const id = Number((await issue(app, await create(app, order)))?.id);
  assertEquals((await cancel(app, id))?.status, "canceled");
  await record(app, { direction: "in", provider: "bank", amount: 47226, currency: "CHF", ref: refOf(id) });
  assertEquals([(await row(app, id))?.status, (await row(app, id))?.paid], ["canceled", 47226]);
});

Deno.test("bad values are refused", async () => {
  const { app } = await setup();
  await assertRejects(() => create(app, { ...order, currency: "chf" }));
  await assertRejects(() => create(app, { ...order, date: "7.10.2026" }));
  await assertRejects(() => create(app, { currency: "CHF", lines: [{ name: "x", price: NaN }] }));
  await assertRejects(() => issue(app, 999), Error, "only drafts");
  const unnumbered = (await setup({ number: "R-{year}" })).app;
  const draft = await create(unnumbered, order);
  await assertRejects(() => issue(unnumbered, draft), Error, "{n}");
});

Deno.test("paid another way, a payment still waiting for it is withdrawn", async () => {
  const { app } = await setup();
  const id = Number((await issue(app, await create(app, order)))?.id);
  const waiting = Number(await app.db.table("payment").insert({
    direction: "in", provider: "qr", amount: 47226, currency: "CHF", status: "pending", ref: refOf(id),
    created: 1, changed: 1,
  }));
  await record(app, { direction: "in", provider: "cash", amount: 47226, currency: "CHF", ref: refOf(id) });
  assertEquals((await row(app, id))?.status, "paid");
  assertEquals(await app.db.one`SELECT status FROM payment WHERE id = ${waiting}`, "canceled");
});

Deno.test("a draft can be thrown away; an issued invoice is revised into a new draft instead", async () => {
  const { app } = await setup();
  const draft = await create(app, order);
  await remove(app, draft);
  assertEquals(await row(app, draft), undefined);
  assertEquals(Number(await app.db.one`SELECT COUNT(*) FROM invoice_line`), 0); // its lines went with it

  const id = Number((await issue(app, await create(app, { ...order, party: { name: "Muster AG" }, ref: "shop.order:5" })))?.id);
  await assertRejects(() => remove(app, id), Error, "only drafts");
  const copy = await revise(app, id);
  assertEquals((await row(app, id))?.status, "canceled");
  const again = await row(app, copy);
  assertEquals([again?.status, again?.number, again?.total, again?.ref], ["draft", null, 47226, "shop.order:5"]);
  assertEquals(JSON.parse(String(again?.party)).name, "Muster AG");
  assertEquals((await lines(app, copy)).map((l) => l.name), ["Design", "Hosting", "Book"]);

  const paid = Number((await issue(app, await create(app, order)))?.id);
  await record(app, { direction: "in", provider: "bank", amount: 100, currency: "CHF", ref: refOf(paid) });
  await assertRejects(() => revise(app, paid), Error, "nothing was paid");
});

Deno.test("a line without a tax rate takes the default one", async () => {
  const { app } = await setup({ taxRate: 8.1 });
  const id = await create(app, {
    currency: "CHF",
    lines: [{ name: "Design", price: 10000 }, { name: "Book", price: 1000, taxRate: 0 }],
  });
  assertEquals((await lines(app, id)).map((l) => Number(l.tax_rate)), [8.1, 0]);
  assertEquals(Number((await row(app, id))?.tax), 810);
});

Deno.test("a credit note counts on its invoice as paid; what goes beyond is owed until paid back", async () => {
  const { app } = await setup();
  const status = async (id: number) => {
    const r = await row(app, id);
    return [r?.status, Number(r?.paid)];
  };
  const one = [{ name: "Design", price: 10000 }];
  const id = Number((await issue(app, await create(app, { currency: "CHF", lines: one })))?.id);
  const note = await creditNote(app, id);
  assertEquals([(await row(app, note))?.type, (await row(app, note))?.total], ["credit_note", -10000]); // as it is
  await update(app, note, { lines: [{ name: "Design", quantity: 1, price: 3000 }] });
  await assertRejects(() => issue(app, note), Error, "below zero"); // a credit note gives back
  await update(app, note, { lines: [{ name: "Design", quantity: -1, price: 3000 }] }); // part of it
  await issue(app, note);
  assertEquals(await status(id), ["open", 3000]); // 70.00 left to pay
  assertEquals(await status(note), ["paid", -3000]); // all of it taken off the invoice
  await assertRejects(() => creditNote(app, note), Error, "issued invoices");

  // paid in full already: a credit note on top is owed to the customer, until paid back
  await record(app, { direction: "in", provider: "bank", amount: 7000, currency: "CHF", ref: refOf(id) });
  assertEquals(await status(id), ["paid", 10000]);
  const more = await creditNote(app, id);
  await update(app, more, { lines: [{ name: "Goodwill", quantity: -1, price: 2000 }] });
  await issue(app, more);
  assertEquals(await status(more), ["open", 0]);
  await record(app, { direction: "out", provider: "bank", amount: 2000, currency: "CHF", ref: refOf(more) });
  assertEquals(await status(more), ["paid", -2000]);

  // revised, a credit note stays one, for the same invoice
  const third = await creditNote(app, id);
  await update(app, third, { lines: [{ name: "Goodwill", quantity: -1, price: 500 }] });
  await issue(app, third);
  const again = await row(app, await revise(app, third));
  assertEquals([again?.type, again?.corrects, again?.total], ["credit_note", id, -500]);
});

Deno.test("a credit note rounds as its invoice: half away from zero", () => {
  const line = { name: "Half", price: 125, taxRate: 10 }; // tax 12.5
  assertEquals(totals([line], false).tax, 13);
  assertEquals(totals([{ ...line, quantity: -1 }], false).tax, -13);
});
