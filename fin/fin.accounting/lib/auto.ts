import { mainCurrency, today } from "@qino/qino/fin";
import { lineOf, lines as linesOf, refOf as invoiceRef, round, totals } from "@qino/qino/fin.invoice";
import { refOf } from "@qino/qino/fin.payment";

import { book, reverse } from "../mod.ts";

import type { App, Row } from "@qino/qino";
import type { Line } from "../mod.ts";

/** The accounts automatic entries go to, by role; a role left empty books nothing that needs it. */
const ROLES = ["receivable", "payable", "revenue", "expense", "vatDue", "vatInput", "fees", "money", "losses"] as const;
type Roles = Record<(typeof ROLES)[number], string>;

/** The account numbers per role, and the book's currency: the main one. Settings are read leaf by leaf. */
async function setup(app: App) {
  const s = app.settings["fin.accounting"];
  const values = await Promise.all(ROLES.map((role) => s.accounts[role]));
  const roles = Object.fromEntries(ROLES.map((role, i) => [role, String(values[i] ?? "").trim()])) as Roles;
  // "bank:1020, cash:1000": where each provider's money lands, else `money`
  const pairs = String(await s.accounts.moneyBy ?? "").split(",").map((pair) => pair.split(":").map((v) => v.trim()));
  const moneyBy = new Map(pairs.filter(([provider, number]) => provider && number) as [string, string][]);
  return { roles, currency: await mainCurrency(app) ?? "", closed: String(await s.closedUntil ?? ""), moneyBy };
}

/** An entry for `ref` that is booked and not taken back. */
const booked = (app: App, ref: string) => app.db.one`
  SELECT e.id FROM accounting_entry e WHERE e.ref = ${ref} AND e.reverses IS NULL
    AND NOT EXISTS (SELECT 1 FROM accounting_entry r WHERE r.reverses = e.id)`;

/** What has been booked so far on one account for `ref`, debit positive. */
const sumOn = (app: App, ref: string, number: string) => app.db.one`
  SELECT COALESCE(SUM(l.amount), 0) FROM accounting_entry_line l
  JOIN accounting_entry e ON e.id = l.entry_id JOIN accounting_account a ON a.id = l.account_id
  WHERE e.ref = ${ref} AND a.number = ${number}`.then(Number);

/** The ref of an invoice's write-off entry. */
const lossRef = (id: number) => `fin.accounting:loss:${id}`;

/** An issued invoice books a claim, a received one a debt; canceled it is taken back, written off its
 *  loss is booked until paid after all. A pro forma books nothing. */
export async function onInvoice(app: App, invoice: Row, previous: string): Promise<void> {
  if (invoice.type === "proforma") return;
  const ref = invoiceRef(Number(invoice.id));
  const taken = async (ref: string) => {
    const entry = await booked(app, ref);
    if (entry) await reverse(app, Number(entry));
  };
  if (invoice.status === "canceled") return taken(ref);
  if (invoice.status === "uncollectible") return writeOff(app, invoice);
  if (previous === "uncollectible") return taken(lossRef(Number(invoice.id)));
  if (previous !== "draft" || await booked(app, ref)) return;
  const { roles, currency, closed } = await setup(app);
  if (invoice.currency !== currency) return; // another currency: booked by hand (see README)
  const total = Number(invoice.total);
  const out = invoice.direction === "out";
  const items = await linesOf(app, Number(invoice.id));
  const { nets, rates } = split(items, Boolean(invoice.tax_included), out ? roles.revenue : roles.expense);
  // a credit note's amounts are negative: it books revenue and tax back by itself
  const sign = out ? -1 : 1;
  const lines: Line[] = [
    ...nets.map((n) => ({ account: n.account, amount: sign * n.amount, taxCode: n.code })),
    ...rates.map((r) => ({ account: out ? roles.vatDue : roles.vatInput, amount: sign * r.tax, taxCode: r.code })),
    { account: out ? roles.receivable : roles.payable, amount: -sign * total },
  ];
  // a role without an account: nothing is booked rather than half of it
  if (lines.some((line) => line.amount && !line.account)) return;
  const date = closed && String(invoice.date) <= closed ? today() : String(invoice.date || today());
  // the invoice's file is the entry's receipt: the original of a received one, the print of an issued one
  const files = invoice.file_id ? [await app.dbFiles.file(Number(invoice.file_id))] : [];
  const text = `${out ? "Invoice" : "Bill"} ${invoice.number ?? invoice.id}`;
  await book(app, { date, text, ref, lines, files });
}

/** A line's tax code: its category and rate, `S8.1`, `E0` — what a tax report adds up. */
const codeOf = (item: Row) => `${item.tax_category || "S"}${Number(item.tax_rate)}`;

/**
 * What an invoice books, by account and tax code: the net of its lines — on their own account,
 * else on `fallback` — and the tax per rate, as the invoice computed it. Within a rate the net is
 * shared by the lines' amounts; the last account takes the rounding, so the entry adds up.
 */
function split(items: Row[], taxIncluded: boolean, fallback: string) {
  const { amounts, rates } = totals(items.map(lineOf), taxIncluded);
  const nets: { account: string; code: string; amount: number }[] = [];
  for (const { rate, net } of rates) {
    const shares = new Map<string, number>();
    items.forEach((item, i) => {
      if (Number(item.tax_rate) !== rate) return;
      const key = `${item.account || fallback}\0${codeOf(item)}`;
      shares.set(key, (shares.get(key) ?? 0) + amounts[i]);
    });
    const sum = [...shares.values()].reduce((a, b) => a + b, 0);
    const parts = [...shares].map(([key, share]) => {
      const [account, code] = key.split("\0");
      return { account, code, amount: round(sum ? share / sum * net : 0) };
    });
    parts[parts.length - 1].amount += net - parts.reduce((a, p) => a + p.amount, 0);
    nets.push(...parts);
  }
  // the tax of a rate carries the code of its lines; the first where they differ
  const coded = rates.map((r) => ({ ...r, code: codeOf(items.find((item) => Number(item.tax_rate) === r.rate)!) }));
  return { nets, rates: coded };
}

/** Write off what is left: a loss (`losses`) and its tax back, shared by the invoice's rates (MWSTG 41). */
async function writeOff(app: App, invoice: Row) {
  const id = Number(invoice.id);
  const { roles, currency } = await setup(app);
  if (invoice.currency !== currency || await booked(app, lossRef(id))) return;
  const open = Number(invoice.total) - Number(invoice.paid);
  const total = Number(invoice.total);
  if (open <= 0 || !total || !roles.losses || !roles.receivable) return;
  const { rates } = split(await linesOf(app, id), Boolean(invoice.tax_included), "");
  const parts = rates.map((r) => {
    const gross = round(open * (r.net + r.tax) / total);
    const tax = round(gross * r.tax / ((r.net + r.tax) || 1));
    return { code: r.code, net: gross - tax, tax };
  });
  // the last rate takes the rounding, so the entry adds up
  parts[parts.length - 1].net += open - parts.reduce((sum, p) => sum + p.net + p.tax, 0);
  if (parts.some((p) => p.tax) && !roles.vatDue) return;
  const lines: Line[] = [
    ...parts.map((p) => ({ account: roles.losses, amount: p.net, taxCode: p.code })),
    ...parts.filter((p) => p.tax).map((p) => ({ account: roles.vatDue, amount: p.tax, taxCode: p.code })),
    { account: roles.receivable, amount: -open },
  ];
  // on the day it is given up: the tax is corrected in that period
  await book(app, { date: today(), text: `Loss ${invoice.number ?? id}`, ref: lossRef(id), lines });
}

/**
 * Money that moved for an invoice: into the provider's money account and out of the receivable,
 * or out of it and off the payable; what the provider kept is a fee. Only what changed since the
 * last entry is booked, so partial payments and refunds add up.
 */
export async function onPayment(app: App, payment: Row): Promise<void> {
  const id = Number(String(payment.ref ?? "").split(":")[1]);
  if (payment.ref !== invoiceRef(id)) return; // what else a payment is for, its consumer books
  const { roles, currency, moneyBy, closed } = await setup(app);
  if (payment.currency !== currency) return;
  const invoice = await app.db.row`SELECT * FROM invoice WHERE id = ${id}`;
  if (!invoice) return;
  // the claim is ours or theirs; the money comes in or goes out — a credit note's refund goes out
  const counter = invoice.direction === "out" ? roles.receivable : roles.payable;
  const incoming = payment.direction === "in";
  const money = moneyBy.get(String(payment.provider)) ?? roles.money;
  if (!counter || !money) return;
  const ref = refOf(Number(payment.id));
  const moved = Number(payment.paid) - Number(payment.refunded);
  const fee = Number(payment.fee);
  const dMoved = moved - (incoming ? -await sumOn(app, ref, counter) : await sumOn(app, ref, counter));
  // what the provider kept needs its account: without one, nothing rather than half of it — the
  // money account would show more than arrived
  if (fee && !roles.fees) return;
  const dFee = roles.fees ? fee - await sumOn(app, ref, roles.fees) : 0;
  if (!dMoved && !dFee) return;
  // in: the provider passes on what it did not keep; out: the bank takes its fee on top
  const lines: Line[] = incoming
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
  // on the day the money moved, where known and still open; a closed period is not booked into
  const date = payment.date && !(closed && String(payment.date) <= closed) ? String(payment.date) : today();
  await book(app, {
    date,
    text: String(payment.description || `Payment #${payment.id}`),
    ref,
    lines: lines.filter((line) => line.account),
  });
  // money on a claim given up: the loss is only what is still missing, its tax owed again (MWSTG 41 I)
  if (invoice.status === "uncollectible") {
    const loss = await booked(app, lossRef(id));
    if (loss) await reverse(app, Number(loss));
    await writeOff(app, invoice);
  }
}
