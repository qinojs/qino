// Invoices both ways in every state, their payments, and a bank statement with something to assign.
import type { Seed } from "../seed.ts";

/** What a small studio bills: description, unit, price in Rappen, tax rate. */
const WORK = [
  ["Design", "h", 12000, 8.1],
  ["Development", "h", 13500, 8.1],
  ["Photography", "h", 9500, 8.1],
  ["Hosting, one year", "", 24000, 8.1],
  ["Domain, one year", "", 2500, 8.1],
  ["Maintenance", "h", 11000, 8.1],
  ["Printed brochure", "pcs", 350, 8.1],
  ["Book", "pcs", 3990, 2.6],
] as const;

/** What a studio receives bills for. */
const BILLS = [
  ["Office rent", 180000],
  ["Software licences", 34900],
  ["Printing", 72500],
  ["Telephone and internet", 8990],
] as const;

const DAY = 86400;
const day = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

type Line = { id: string; date: string; amount: number; reference?: string; partyName?: string; text?: string };

export async function run(s: Seed): Promise<void> {
  if (!s.module("fin.invoice") || !s.module("fin.payment")) return;
  const bank = s.module("fin.bank");
  // a QR bill needs its account, and the public address the payer comes back to
  const qr = bank && s.module("fin.payment.qrbill") && !!await s.app.settings["fin.payment.qrbill"].iban
    && !!await s.app.settings.core.url;
  /** Statement lines, read at the end as one statement. */
  const lines: Line[] = [];
  // issued in the order of their dates, as numbers are drawn
  const dates = Array.from({ length: s.many(24) }, () => s.rnd.past(120, s.now)).sort((a, b) => a - b);
  // the newest are still drafts
  for (const [i, date] of dates.entries()) await issued(s, qr, lines, date, i >= dates.length - 2);
  for (let i = 0; i < s.many(6); i++) await received(s);
  if (bank) await statement(s, lines);
  if (s.module("fin.accounting")) await bookkeeping(s);
}

/** What a studio books by hand each month — the invoices and payments book themselves. */
async function bookkeeping(s: Seed): Promise<void> {
  const { book } = await import("@qino/qino/fin.accounting");
  const known = new Set((await s.db.col`SELECT number FROM account`).map(String));
  if (!["6000", "6570", "1020"].every((n) => known.has(n))) return; // no chart to book on
  for (let month = 3; month >= 1; month--) {
    const date = day(s.now - month * 30 * DAY);
    const paid = (account: string, amount: number) => [{ account, amount }, { account: "1020", amount: -amount }];
    await book(s.app, { date, text: "Office rent", lines: paid("6000", 180000) });
    await book(s.app, { date, text: "Software licences", lines: paid("6570", 4990) });
    s.count("entries", 2);
  }
}

/** An invoice we issue, in one of its lives: draft, canceled, open (overdue when old), paid in
 *  part or in full — by QR bill through the bank, by transfer or in cash. */
async function issued(s: Seed, qr: boolean, lines: Line[], date: number, draft: boolean): Promise<void> {
  const { create, issue, cancel, refOf } = await import("@qino/qino/fin.invoice");
  const { create: pay, record } = await import("@qino/qino/fin.payment");
  const who = s.usrs.length && s.rnd.chance(0.5) ? s.rnd.pick(s.usrs) : undefined;
  const person = s.rnd.person();
  const name = who
    ? `${who.given_name} ${who.family_name}`
    : person.organization || `${person.given_name} ${person.family_name}`;
  const id = await create(s.app, {
    currency: "CHF",
    date: day(date),
    usrId: who?.id,
    party: {
      name,
      address: {
        streetAddress: `${s.rnd.title(1)}strasse ${s.rnd.int(1, 80)}`,
        postalCode: String(s.rnd.int(1000, 9658)),
        addressLocality: person.city,
      },
    },
    title: s.rnd.chance(0.3) ? s.rnd.title(2) : undefined,
    lines: s.rnd.some(WORK, s.rnd.int(1, 4)).map(([name, unit, price, taxRate]) => ({
      name,
      unit: unit || undefined,
      quantity: unit === "h" ? s.rnd.int(2, 24) / 2 : unit ? s.rnd.int(10, 500) : 1,
      price,
      taxRate,
    })),
    text: s.rnd.chance(0.4) ? "Thank you for the good work together." : undefined,
  });
  s.count("invoices");
  await s.db.exec`UPDATE invoice SET created = ${date}, changed = ${date} WHERE id = ${id}`; // written then, not now

  if (draft) return;
  const fate = s.rnd.next();
  const invoice = (await issue(s.app, id))!;
  if (fate < 0.08) return void await cancel(s.app, id);
  if (fate < 0.4) return; // open
  const total = Number(invoice.total);
  const when = Math.min(s.now, date + s.rnd.int(2, 40) * DAY);
  const amount = fate < 0.55 ? Math.round(total * s.rnd.int(3, 7) / 10) : total; // some pay in part
  if (qr && s.rnd.chance(0.6)) {
    // asked for by QR bill, paid by e-banking: the statement settles it
    const description = `Invoice ${invoice.number}`;
    const order = { method: "qrbill", amount: total, currency: "CHF", ref: refOf(id), description, return: "/" };
    const { id: payment } = await pay(s.app, order);
    const reference = String(await s.db.one`SELECT external_id FROM payment WHERE id = ${payment}`);
    lines.push({ id: `demo-qr-${payment}`, date: day(when), amount, reference, partyName: name });
  } else {
    // paid online too where a provider is linked — recorded as done, so nothing asks it again
    const [provider, method] = s.rnd.pick(ways(s));
    await record(s.app, { direction: "in", provider, method, amount, currency: "CHF", ref: refOf(id) });
  }
  // paid when it was paid, not when the demo ran
  await s.db.exec`UPDATE payment SET created = ${when}, changed = ${when} WHERE ref = ${refOf(id)}`;
}

/** How money came in: by bank and in cash, and through each payment provider that is linked. */
function ways(s: Seed): [string, string | undefined][] {
  type Way = [string, string | undefined];
  const online: [string, Way][] = [
    ["fin.payment.saferpay", ["saferpay", "twint"]],
    ["fin.payment.saferpay", ["saferpay", "visa"]],
    ["fin.payment.btcpay", ["btcpay", undefined]],
    ["fin.payment.lightning", ["lightning", undefined]],
    ["fin.payment.bitcoin", ["bitcoin", undefined]],
    ["fin.payment.stripe", ["stripe", "card"]],
    ["fin.payment.paypal", ["paypal", undefined]],
  ];
  const linked = online.filter(([module]) => s.module(module)).map(([, way]) => way);
  return [["bank", undefined], ["bank", undefined], ["cash", undefined], ...linked];
}

/** A bill we received, most of them paid. */
async function received(s: Seed): Promise<void> {
  const { create, issue, refOf } = await import("@qino/qino/fin.invoice");
  const { record } = await import("@qino/qino/fin.payment");
  const [name, price] = s.rnd.pick(BILLS);
  const id = await create(s.app, {
    direction: "in",
    currency: "CHF",
    number: `${s.rnd.pick(["R", "INV-", "F"])}${s.rnd.int(1000, 99999)}`,
    date: day(s.rnd.past(90, s.now)),
    party: { name: s.rnd.person().organization || "Supplier AG", iban: "CH93 0076 2011 6238 5295 7" },
    lines: [{ name, price, taxRate: 8.1 }],
  });
  const invoice = (await issue(s.app, id))!;
  s.count("received invoices");
  if (!s.rnd.chance(0.7)) return;
  const amount = Number(invoice.total);
  await record(s.app, { direction: "out", provider: "bank", amount, currency: "CHF", ref: refOf(id) });
}

/** One statement: the QR payments, an open invoice paid without its reference (assign it by hand),
 *  the bank's fees and a gift nobody expected. */
async function statement(s: Seed, lines: Line[]): Promise<void> {
  const { ingest } = await import("@qino/qino/fin.bank");
  const open = await s.db.row`
    SELECT total, party FROM invoice WHERE direction = 'out' AND status = 'open' ORDER BY id LIMIT 1`;
  if (open) {
    const partyName = String(JSON.parse(String(open.party ?? "{}"))?.name ?? "");
    const amount = Number(open.total);
    lines.push({ id: "demo-unclaimed", date: day(s.now - DAY), amount, partyName, text: "Payment" });
  }
  lines.push(
    { id: "demo-fee-1", date: day(s.now - 20 * DAY), amount: -450, text: "Account fee" },
    { id: "demo-fee-2", date: day(s.now - 50 * DAY), amount: -450, text: "Account fee" },
    { id: "demo-gift", date: day(s.now - 9 * DAY), amount: 12000, partyName: "Anonymous", text: "Gift" },
  );
  const statement = { account: "CH56 0483 5012 3456 7800 9", currency: "CHF", name: "Demo account" };
  const { added } = await ingest(s.app, { ...statement, transactions: lines });
  s.count("bank lines", added);
}
