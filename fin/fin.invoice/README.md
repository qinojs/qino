# fin.invoice

**Claims, both ways.** `out` is an invoice we issue (a receivable), `in` one we receive (a
payable). Lines, tax, numbers, and `paid` as its [payments](../fin.payment/) say — no bookkeeping
needed.

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
    { title: "Design", qty: 2.5, unit: "h", price: 12000, taxRate: 8.1 }, // minor units, percent
    { title: "Hosting", price: 9900, taxRate: 8.1 },
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

`draft` → `open` (issued) → `paid`; `canceled` from either. Overdue is not a status but `due` in the
past. A draft can be changed with `update()`; lines given replace the old ones.

## Paid

Every payment with `ref` `fin.invoice:<id>` counts with what moved (`paid`, whatever its status —
a QR bill paid in part is still `processing`): incoming money for an outgoing invoice, outgoing
money for an incoming one, less refunds. On each `payment:change` the invoice adds them
up again, so partial payments, several methods and refunds just work; a refund below the total
reopens it. `invoice:status` fires once per change.

## Lines and tax

Prices are per unit, in minor units of the currency (Rappen, cents, fils — as many decimals as
ISO 4217 gives it), and finer where a unit costs less: `23.45` is 0.2345 CHF per kWh. Line amounts
and totals are whole minor units. Prices are net — or gross with `gross: true`, and the tax is
taken out.
Tax is rounded once per rate, not per line. The rate comes from the caller: VAT, GST and sales tax
look alike here, and which rate applies is the consumer's business.

## Numbers

Outgoing invoices draw a number when issued, in the order of issuing and without gaps. Setting
`fin.invoice.number` is the format — `{year}` and `{n}`, default `{year}-{n}`; with `{year}` the
count restarts each year. Incoming invoices keep the sender's `number`. `fin.invoice.term` is the
days until due, default 30.

## The other side, the document

`party` is the other side as printed, shaped like `identity.organization` — `name`, `legalName`,
`address` (`streetAddress`, `postalCode`, `addressLocality`, `addressCountry` …), `vatID`, `taxID`,
and `iban` for one received. Sender and recipient have the same shape. It is a snapshot: what the
invoice said stays, whatever the user changes later.

`document()` is the invoice as HTML in its `lang` (the request's language when created): sender
from `identity`, logo, lines, tax per rate, totals. `print()` turns it into a PDF with
[pdf](../../module/pdf/) and keeps that as the invoice's file — the document as sent; printing
again replaces it. A site with its own layout passes its HTML: `print(app, id, { html })`. Only the
invoice's user may download the file, everyone else needs a signed link.

With `fin.invoice.method` set (e.g. `qrbill`), issuing an outgoing invoice asks for its payment
by that method at once, so its slip — the QR bill — is part of the invoice from the start; a
draft's preview says where it will be. Without it, payments are asked for one by one.

`remove()` throws a draft away. An issued invoice nothing was paid on is corrected with
`revise()`: it is canceled (its number stays used) and a draft with the same content takes its
place.

Not yet: cash rounding, dunning, e-invoice formats.
