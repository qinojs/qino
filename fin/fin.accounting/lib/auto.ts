import { book, reverse } from "../mod.ts";

import type { App, Row } from "@qino/qino";
import type { Line } from "../mod.ts";

/** The accounts automatic entries go to, by role; a role left empty books nothing that needs it. */
const ROLES = ["receivable", "payable", "revenue", "expense", "vatDue", "vatInput", "fees", "money"] as const;
type Roles = Record<(typeof ROLES)[number], string>;

const today = () => new Date().toLocaleDateString("sv-SE");

/** The account numbers per role, and the book's currency. Settings are read leaf by leaf. */
async function setup(app: App) {
  const s = app.settings["fin.accounting"];
  const values = await Promise.all(ROLES.map((role) => s.accounts[role]));
  const roles = Object.fromEntries(ROLES.map((role, i) => [role, String(values[i] ?? "").trim()])) as Roles;
  // "bank:1020, cash:1000": where each provider's money lands, else `money`
  const pairs = String(await s.accounts.moneyBy ?? "").split(",").map((pair) => pair.split(":").map((v) => v.trim()));
  const moneyBy = new Map(pairs.filter(([provider, number]) => provider && number) as [string, string][]);
  return { roles, currency: String(await s.currency ?? ""), closed: String(await s.closedUntil ?? ""), moneyBy };
}

/** An entry for `ref` that is booked and not taken back. */
const booked = (app: App, ref: string) => app.db.one`
  SELECT e.id FROM entry e WHERE e.ref = ${ref} AND e.reverses IS NULL
    AND NOT EXISTS (SELECT 1 FROM entry r WHERE r.reverses = e.id)`;

/** What has been booked so far on one account for `ref`, debit positive. */
const sumOn = (app: App, ref: string, number: string) => app.db.one`
  SELECT COALESCE(SUM(l.amount), 0) FROM entry_line l
  JOIN entry e ON e.id = l.entry_id JOIN account a ON a.id = l.account_id
  WHERE e.ref = ${ref} AND a.number = ${number}`.then(Number);

/**
 * An issued invoice is a claim, a received one a debt: receivable to revenue and tax due, or
 * expense and input tax to payable. A canceled one is taken back.
 */
export async function onInvoice(app: App, invoice: Row, previous: string): Promise<void> {
  const ref = `fin.invoice:${invoice.id}`;
  if (invoice.status === "canceled") {
    const entry = await booked(app, ref);
    if (entry) await reverse(app, Number(entry));
    return;
  }
  if (previous !== "draft" || await booked(app, ref)) return;
  const { roles, currency, closed } = await setup(app);
  if (invoice.currency !== currency) return; // another currency: booked by hand (see README)
  const [total, net, tax] = [Number(invoice.total), Number(invoice.net), Number(invoice.tax)];
  const out = invoice.direction === "out";
  const lines: Line[] = out
    ? [
      { account: roles.receivable, amount: total },
      { account: roles.revenue, amount: -net },
      { account: roles.vatDue, amount: -tax },
    ]
    : [
      { account: roles.expense, amount: net },
      { account: roles.vatInput, amount: tax },
      { account: roles.payable, amount: -total },
    ];
  // a role without an account: nothing is booked rather than half of it
  if (lines.some((line) => line.amount && !line.account)) return;
  const date = closed && String(invoice.date) <= closed ? today() : String(invoice.date || today());
  // the invoice's file is the entry's receipt: the original of a received one, the print of an issued one
  const files = invoice.file_id ? [await app.dbFiles.file(Number(invoice.file_id))] : [];
  const text = `${out ? "Invoice" : "Bill"} ${invoice.number ?? invoice.id}`;
  await book(app, { date, text, ref, lines, currency, files });
}

/**
 * Money that moved for an invoice: into the provider's money account and out of the receivable,
 * or out of it and off the payable; what the provider kept is a fee. Only what changed since the
 * last entry is booked, so partial payments and refunds add up.
 */
export async function onPayment(app: App, payment: Row): Promise<void> {
  const [module, id] = String(payment.ref ?? "").split(":");
  if (module !== "fin.invoice" || !id) return; // what else a payment is for, its consumer books
  const { roles, currency, moneyBy } = await setup(app);
  if (payment.currency !== currency) return;
  const invoice = await app.db.row`SELECT direction FROM invoice WHERE id = ${Number(id)}`;
  if (!invoice) return;
  const out = invoice.direction === "out";
  const counter = out ? roles.receivable : roles.payable;
  const money = moneyBy.get(String(payment.provider)) ?? roles.money;
  if (!counter || !money) return;
  const ref = `fin.payment:${payment.id}`;
  const moved = Number(payment.paid) - Number(payment.refunded);
  const fee = Number(payment.fee);
  const dMoved = moved - (out ? -await sumOn(app, ref, counter) : await sumOn(app, ref, counter));
  const dFee = roles.fees ? fee - await sumOn(app, ref, roles.fees) : 0;
  if (!dMoved && !dFee) return;
  // in: the provider passes on what it did not keep; out: the bank takes its fee on top
  const lines: Line[] = out
    ? [
      { account: counter, amount: -dMoved },
      { account: money, amount: dMoved - dFee },
      { account: roles.fees, amount: dFee },
    ]
    : [
      { account: counter, amount: dMoved },
      { account: money, amount: -dMoved - dFee },
      { account: roles.fees, amount: dFee },
    ];
  await book(app, {
    date: today(),
    text: String(payment.title || `Payment #${payment.id}`),
    ref,
    lines: lines.filter((line) => line.account),
    currency,
  });
}
