import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { addDays, today } from "@qino/qino/fin";
import { create, issue, lines, owed } from "@qino/qino/fin.invoice";
import { setTransport } from "@qino/qino/messaging.email";

import { withFinApp } from "../../tests/app.ts";
import { remind, remindDue } from "../mod.ts";

import type { App } from "@qino/qino";

// on the server's calendar, as the reminders count
const day = (n: number) => addDays(today(), n);

const MODULES = ["fin.payment", "fin.invoice", "messaging", "messaging.email", "fin.invoice.reminder"];

/** A customer who can be mailed, and the mails that go out. */
async function customer(app: App, fail = false) {
  app.languages.setLangs(["en", "de"]);
  await app.settings["messaging.email"].address("office@atelier.test");
  const sent: Record<string, unknown>[] = [];
  setTransport(app, {
    send: (m) => fail
      ? Promise.resolve({ successful: false, errorMessages: [] })
      : (sent.push(m as Record<string, unknown>), Promise.resolve({ successful: true })),
  });
  const usr = Number(await app.db.table("usr").insert({
    active: 1, pw: "", superuser: 0, given_name: "Anna", family_name: "Muster",
  }));
  await app.db.table("usr_contact").insert({ type: "email", address: "anna@example.com", usr_id: usr, main: 1 });
  return { usr, sent };
}

const lines8 = [{ name: "Design", price: 10000, taxRate: 8.1 }];
const issued = async (app: App, values: Record<string, unknown>) =>
  Number((await issue(app, await create(app, { currency: "CHF", lines: lines8, ...values })))?.id);
const reminders = (app: App) => app.db.query`SELECT * FROM invoice WHERE type = 'reminder' ORDER BY id`;
const listed = (app: App, id: number) =>
  app.db.query`SELECT listed_id, open, level FROM invoice_listed WHERE invoice_id = ${id} ORDER BY listed_id`;

Deno.test("overdue invoices are reminded in levels, apart, one reminder per customer", async () => {
  await withFinApp(MODULES, async (app) => {
    const { usr, sent } = await customer(app);
    const old = await issued(app, { usrId: usr, lang: "de", date: day(-70), due: day(-40) });
    const older = await issued(app, { usrId: usr, lang: "de", date: day(-80), due: day(-50) });
    await issued(app, { usrId: usr, due: day(-5) }); // 5 days over: not yet
    const nobody = await issued(app, { due: day(-40) });

    assertEquals(await remindDue(app), 2); // the customer's two together, and the one without a user alone
    const [first, alone] = await reminders(app);
    assertEquals((await listed(app, Number(first.id))).map((r) => [r.listed_id, r.level]), [[old, 1], [older, 1]]);
    assertEquals([first.usr_id, first.status, first.number, first.sent], [usr, "paid", `M${today().slice(0, 4)}-1`, today()]);
    assertEquals(await owed(app, first), 21620); // no fee: what the two ask for
    assertEquals(String(sent[0].subject), `Zahlungserinnerung ${first.number}`);
    assertEquals((await listed(app, Number(alone.id))).map((r) => r.listed_id), [nobody]);
    assertEquals(alone.sent, null); // nobody to mail it to: printed and posted by hand

    assertEquals(await remindDue(app), 0); // the next level only 10 days after this one
    await app.db.exec`UPDATE invoice SET date = ${day(-10)} WHERE type = 'reminder'`;
    assertEquals(await remindDue(app), 2);
    const second = (await reminders(app)).at(-2)!;
    assertStringIncludes(String(sent[1].subject), "1. Mahnung");
    assertEquals((await listed(app, Number(second.id))).map((r) => r.level), [2, 2]);
  });
});

Deno.test("a fee is taxed as what it reminds of, shared by what is open; interest is not taxed", async () => {
  await withFinApp(MODULES, async (app) => {
    const { usr } = await customer(app);
    await app.settings["fin.invoice.reminder"].fees("0, 20");
    await app.settings["fin.invoice.reminder"].interest(5);
    const a = await issued(app, { usrId: usr, due: day(-50) });
    const b = await issued(app, { usrId: usr, due: day(-50), lines: [{ name: "Book", price: 10000, taxRate: 2.6 }] });
    // the payment reminder: no fee, interest for 50 days on 108.10 and 102.60
    const first = await remind(app, [a, b]);
    assertEquals((await lines(app, first)).map((l) => [l.amount, Number(l.tax_rate), l.tax_category]), [[74, 0, "O"], [70, 0, "O"]]);
    assertStringIncludes(String((await lines(app, first))[0].name), "Default interest 5 % on ");
    // the next level: CHF 20, half at each rate; no interest since the last reminder today
    const second = await remind(app, [a, b]);
    assertEquals((await lines(app, second)).map((l) => [l.name, l.amount, Number(l.tax_rate), l.tax_category]), [
      ["Reminder fee", 1000, 8.1, "S"],
      ["Reminder fee", 1000, 2.6, "S"],
    ]);
    const reminder = await app.db.row`SELECT * FROM invoice WHERE id = ${second}`;
    assertEquals([reminder?.total, reminder?.tax_included], [2000, 1]); // the tax is in the fee
  });
});

Deno.test("held, or on a reminder waiting as a draft, an invoice is not reminded again", async () => {
  await withFinApp(MODULES, async (app) => {
    const { usr } = await customer(app);
    const held = await issued(app, { usrId: usr, due: day(-40) });
    await app.db.exec`UPDATE invoice SET remind = ${false} WHERE id = ${held}`;
    assertEquals(await remindDue(app), 0);
    await app.db.exec`UPDATE invoice SET remind = ${true} WHERE id = ${held}`;
    await app.settings["fin.invoice.reminder"].issue(false);
    assertEquals(await remindDue(app), 1);
    assertEquals((await reminders(app))[0].status, "draft"); // to be looked at
    assertEquals(await remindDue(app), 0); // not twice
  });
});

Deno.test("a reminder that could not be mailed counts all the same: no second one the next day", async () => {
  await withFinApp(MODULES, async (app) => {
    const { usr } = await customer(app, true);
    await issued(app, { usrId: usr, due: day(-40) });
    assertEquals(await remindDue(app), 1);
    assertEquals((await reminders(app))[0].sent, null);
    assertEquals(await remindDue(app), 0);
  });
});

Deno.test("one reminder is for one debtor and currency, of open invoices of ours", async () => {
  await withFinApp(MODULES, async (app) => {
    const { usr } = await customer(app);
    const a = await issued(app, { usrId: usr, due: day(-40) });
    const b = await issued(app, { due: day(-40) });
    const euro = await issued(app, { usrId: usr, due: day(-40), currency: "EUR" });
    await assertRejects(() => remind(app, [a, b]), Error, "one debtor");
    await assertRejects(() => remind(app, [a, euro]), Error, "one debtor");
    await assertRejects(() => remind(app, [999]), Error, "only open");
  });
});
