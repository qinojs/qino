# fin.invoice

**Claims, both ways.** `out` is an invoice we issue (a receivable), `in` one we receive (a
payable). Lines, tax, numbers, and `paid` as its [payments](../fin.payment/) say — no bookkeeping
needed. The document is the open item: what is owed, paid and due is on it, as every open item in
SAP or Business Central has its document.

```ts
import { create, issue, refOf } from "@qino/qino/fin.invoice";
import { create as pay, record } from "@qino/qino/fin.payment";

const id = await create(app, {
  currency: "CHF",
  party: {
    name: "Muster AG",
    address: { streetAddress: "Hauptgasse 1", postalCode: "3280", addressLocality: "Murten" },
  },
  lines: [
    // prices in minor units, tax rates in percent
    { name: "Design", description: "Logo and colours", quantity: 2.5, unit: "h", price: 12000, taxRate: 8.1 },
    { name: "Hosting", price: 9900, taxRate: 8.1 },
  ],
  ref: "shop.order:12",
});
const invoice = await issue(app, id); // number drawn, dated, due after the term

// paid online …
const open = Number(invoice.total) - Number(invoice.paid);
const { redirect } = await pay(app, {
  method: "saferpay", amount: open, currency: "CHF", ref: refOf(id), return: "/invoice/done",
});
// … or by hand
await record(app, { direction: "in", provider: "cash", amount: 4000, currency: "CHF", ref: refOf(id) });
```

`draft` → `open` (issued) → `paid`; `uncollectible` (written off) and `canceled` beside. Overdue is
not a status but `due` in the past. A draft can be changed with `update()`; lines given replace the
old ones.

## Types

| `type` | | Claims | Numbers (setting) |
|---|---|---|---|
| `invoice` | EN 16931 380 | its total | `number`, default `{year}-{n}` |
| `credit_note` | 381, corrects an invoice | its total, negative | `creditNumber`, else with the invoices |
| `proforma` | 325, asks for payment first | nothing | `proformaNumber`, default `P{year}-{n}` |
| `reminder` | of overdue invoices | its own lines: fee, interest | `reminderNumber`, default `M{year}-{n}` |

`preceding` is the document one follows (EN 16931 BT-25): a credit note's invoice, an invoice's pro
forma. `invoice_listed` holds what a document lists — a reminder its overdue invoices, with what
was open on each and its reminder level ([fin.invoice.reminder](../fin.invoice.reminder/)).

## Paid

What settles a document is in `invoice_settlement`: a payment, a share of one, or a credit note —
one mechanism, as open items are cleared against each other. On each
`payment:change` of a payment with `ref` `fin.invoice:<id>`, `allocate()` spreads what it moved
(`paid` less `refunded`, whatever its status — a QR bill paid in part is still `processing`):

1. to the document its `ref` names — a reminder's fee and interest before the debt (OR 85),
2. then to the open documents it lists, the oldest due first (OR 87),

each up to what is open on it; the rest stays on the named one, overpaid (`paid` > `total`). Only
money in the document's direction counts: in for ours, out for received ones and our credit notes.
Each document then adds up what it got (`settle`), so partial payments, several methods and
refunds just work; a refund below the total reopens it. `invoice:status` fires once per change.
`owed()` is what an issued document asks for: what is open on it and on what it lists.

## Pro forma

A pro forma invoice asks for payment before the invoice: issued, it has its number and slip, but
claims nothing and books nothing. `finalize(app, id)` turns it into its invoice — the same content,
issued, `preceding` the pro forma —; money paid on the pro forma does that by itself, dated the day
it came (the tax arises with a prepayment, MWSTG 40 I c) and goes to the invoice. The pro forma is
`paid` then: done.

## Correcting

- `cancel()`: an invoice of ours that went out (`sent`) is taken back by a credit note over all of
  it — a document that names and revokes it (MWSTG 27 IV) —, and counts as settled by it. Anything
  else is `canceled`; its number stays used.
- `revise()`: an open invoice nothing was paid on is canceled so, and a draft with the same content
  takes its place.
- `writeOff()`: what is left on an open invoice of ours is given up: `uncollectible`. Bookkeeping
  books the loss and takes its tax back (MWSTG 41). Money that comes after all settles it.

## Lines and tax

Prices are per unit, in minor units of the currency (Rappen, cents, fils — as many decimals as
ISO 4217 gives it), and finer where a unit costs less: `23.45` is 0.2345 CHF per kWh. Line amounts
and totals are whole minor units. Prices are net — or include tax with `taxIncluded: true`, and
the tax is taken out.
Tax is rounded once per rate, not per line. The rate comes from the caller: VAT, GST and sales tax
look alike here, and which rate applies is the consumer's business. A line without one takes
`fin.invoice.taxRate` (empty: no tax). Its `taxCategory` (EN 16931, UNCL 5305) says what kind of
tax it is: `S` standard, `Z` zero rated, `E` exempt, `AE` reverse charge, `K` intra-community, `G`
export, `O` not subject to tax; none: `S` with a rate, `O` without. Without it a 0 % line could be
an export, an excluded service or no turnover at all — different figures on a VAT return. A line
may name the `account` it is booked on, where bookkeeping keeps that column
([fin.accounting](../fin.accounting/)).

## Numbers

Outgoing documents draw a number when issued, in the order of issuing and without gaps, each type
in its sequence (see Types). Setting `fin.invoice.number` is the format — `{year}` and `{n}`, default `{year}-{n}`; with `{year}` the
count restarts each year. Incoming invoices keep the sender's `number`. An invoice's `term` is the
days to pay; without one `fin.invoice.term` (30) applies, and issuing sets `due` from it — unless
a due date was given — and keeps the term to print it ("Payable within 30 days").

## Credit notes

`creditNote(app, id)` makes a draft credit note (EN 16931 type 381) for an issued invoice of
ours: its lines, party and terms, to be cut down to what is given back. It is stored as what it
is — negative quantities at the invoice's prices, so its amounts and totals are negative and any
sum over invoices comes out right without asking for the type (as ERPNext and Dolibarr keep it);
its document, and the invoice editor, show them positive. Rounding is half away from zero, so a
full credit note's tax is its invoice's to the cent. Issued, it draws its
number — with the invoices, or from `fin.invoice.creditNumber` — books revenue and tax back, and
takes off the invoice it corrects (`preceding`) what is still open there, as a settlement like a
payment. What it gives beyond is owed to the customer: it stays open until paid back (an outgoing payment) or put
onto their credit (`fin.payment.credit`). Its document says "Credit note" and names the invoice;
it asks for no payment, and no reminder goes out for it.

## The other side, the document

`party` is the other side as printed, shaped like `identity.organization` — `name`, `legalName`,
`address` (`streetAddress`, `postalCode`, `addressLocality`, `addressCountry` …), `vatID`, `taxID`,
and `iban` for one received. Sender and recipient have the same shape. It is a snapshot: what the
invoice said stays, whatever the user changes later.

`document()` is the invoice as HTML in its `lang` (the request's language when created; one the
site has no texts for falls back to the default one): sender from `identity`, logo, lines, tax per
rate — a column only where rates differ, none without tax —, totals. Its texts are those of the
namespace `fin` ([fin/locale](../fin/locale/)). A draft says so in its heading. `print()` turns it into a PDF with
[pdf](../../module/pdf/) and keeps that as the invoice's file — the document as sent; printing
again replaces it until it went out (`sent`): from then on it stays as it was (OR 958f, GeBüV). A site with its own layout passes its HTML: `print(app, id, { html })`. Only the
invoice's user may download the file, everyone else needs a signed link.

With `fin.invoice.method` set (e.g. `qrbill`), issuing an outgoing invoice asks for its payment
by that method at once, so its slip — the QR bill — is part of the invoice from the start; a
draft's preview shows the slip it will get. Its payments carry the party as payer
(`payerOf()`), so a slip prints who pays. Without a method, payments are asked for one by one.

`send(app, id)` mails it with its PDF to its user, or `{ email }`; the first time it reaches someone
is `sent` — set by hand with `setSent()` where it went by post.

`mail(app, id)` is the mail an issued document goes out with — subject, a few lines, its PDF, in its
language — for a channel to deliver; a reminder's names the invoices it lists.

`remove()` throws a draft away; an issued one is corrected as above.

Not yet: cash rounding, e-invoice formats.
