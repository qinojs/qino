# PLAN fin

Money in qino: getting paid, paying, claims, bank reconciliation, bookkeeping. A basis for
discussion. The modules live in their own store, this folder; the module `fin` is their base
(the texts payers read, users' postal address and IBAN).

## Principles

- **International core.** Generic modules know no country. Anything national — QR bill, a chart of
  accounts, a VAT report, a local bank API — lives in its own module, named after it (`qrbill`,
  `blink`) or suffixed with the country code (`fin.accounting.ch`).
- **Each layer stands alone.** Payment without invoices (shop, donation), invoices without
  bookkeeping, bookkeeping without either (manual entries). Layers above listen, layers below
  never know them.
- **Coupled by `ref` and events, not by foreign keys.** `ref` is `<module>:<id>` (`shop.order:12`,
  `fin.invoice:7`). Whoever owns the thing listens to the event and finds it by `ref`.
- **Amounts are integers in minor units, always paired with a currency.** Decimals, names and
  formatting come from [locale.currency](../module/locale.currency/); rates used in a booking
  are stored with the booking.
- **`direction: in | out` wherever money or claims flow**, from day one — like the messaging
  journal. Building only `in` first is fine; adding the column later is a rebuild.
- **The outside world is the source of truth.** Provider and bank say what happened; nothing a
  browser or webhook sends is trusted as such.
- **Books are append-only.** Corrections are reversals, not edits — what bookkeeping laws
  require almost everywhere.

## Layers

```
fin.payment            money flow, in/out, providers
fin.payment.<x>        saferpay, btcpay, bitcoin, qrbill, transfer, pain001 …
fin.invoice            claims, in/out, lines, numbers, PDF
fin.bank               statements: accounts, transactions, import, matching
fin.bank.<x>           camt, ebics, blink, paypal-csv …
fin.wallet             a user's credit, as a ledger; also a payment provider
fin.accounting         double entry, receipts, years, carry-over
fin.accounting.<cc>    per country: chart of accounts, VAT report (ch, de, at …)
cms.backend.fin.*      UI for each
pdf                        HTML → PDF, a primitive of its own (not finance)
```

Dependencies, only downwards:

```
fin.invoice ──► fin.payment ◄── fin.payment.<x>
                                         ▲ (qrbill, transfer, pain001)
                         fin.bank ───┘
fin.wallet ──► fin.payment (as provider)
fin.accounting ··· listens to payment / invoice / bank if linked, needs none
```

## fin.payment

**Built** (core: create, record, sync, refund, return/notify routes, cron) — see its
[README](fin.payment/README.md). Built since: `webhook`, `slip`/`pay` page, `watch`, `cancel`. Still open: `send` (out).

A payment is money that moved, or is about to, for some `ref`.

Table `payment`: `direction`, `provider`, `method`, `amount`, `currency`, `paid`, `refunded`,
`fee`, `status`, `ref`, `description`, `usr_id`, `external_id` (the provider's id or reference), `return_url`,
`data` (provider state, JSON), `created`, `changed`.

Status: `pending → processing → paid`, later maybe `refunded`; `failed | canceled | expired` end it
unpaid. `paid` and `refunded` are amounts too: crypto may bring more or less, refunds may be
partial. `fee` is what the provider kept — accounting needs it.

Two ways in:
- **started** — `create(app, { direction, amount, currency, method, ref, return })` → the provider
  takes over (redirect, own page, payout order).
- **recorded** — `record(app, { … })` for what already happened without a provider flow: cash, a
  bank transfer assigned by hand. Same row, same event; `provider` names the source.

Provider (`export const paymentProvider`), each declares what it can:
`methods(app, offer)`, `start(app, payment, urls)` (in), `send(app, payment)` (out),
`sync(app, payment)` (always), optional `webhook(ctx)`, `slip(app, payment)`, `watch`, `refund(…)`.

`sync` is the only path a status changes. Return, notify, webhook, bank import and a cron for open
payments merely trigger it. The update is conditional on the old status, so `payment:change` fires
once per change.

Routes: `payment/return/<token>`, `payment/notify/<token>`, `payment/pay/<token>` (the provider's
`slip`: QR bill, crypto address) — built; `payment/webhook/<provider>` built. Tokens signed per
payment. The event is `payment:change`: a new status, or money that moved.

Outgoing payments need a release step before `send`. Who may release is plain access to the module
(access = usage); amount limits and four eyes only when someone needs them. The status model
already fits.

## fin.payment.\<x\>

| Module | Dir | How the status is known |
|---|---|---|
| `saferpay` | in | **built** — Payment Page: Assert, then Capture; refund + capture via Capture id |
| `btcpay` | in | **built** — API of a (self-hosted) BTCPay server, HMAC webhook |
| `bitcoin` | in | **built** — own address per payment from an xpub, chain via Esplora; no private key on the server |
| `lightning` | in | **built** — through an LNbits wallet (LND, CLN, Phoenix … behind it) |
| `qrbill` | in | **built** — Swiss QR bill; QR or RF reference in `external_id`; settled by fin.bank |
| `transfer` | in | plain bank transfer with a reference in the message; matched like qrbill, more loosely |
| `wallet` | in/out | own ledger (`fin.wallet`): pay from credit, refund or pay out to credit |
| `stripe` | in | **built** — Checkout session; fee and refunds via its PaymentIntent; signed webhook |
| `paypal` | in | **built** — Orders v2: approved, captured on return; refund via the capture |
| `pain001` | out | ISO 20022 payment order file (later via EBICS); confirmed by the debit in the statement |

`qrbill` is a payment provider, not part of the invoice: a checkout can offer it like any method,
and an invoice simply has a pending payment whose slip it prints.

## fin.invoice

**Built** (drafts, lines, tax per rate, net/gross, gapless numbers per format, settled by payments)
and document/PDF via [pdf](../module/pdf/) — see its [README](fin.invoice/README.md).
Built since: credit notes (type 381, `corrects`), payment term in days, mail with its PDF, default
tax rate, the party as payer of its payments; `fin.invoice.reminder` (dunning by levels, cron,
mail); `fin.subscription` (plans, periods billed in advance, one invoice per customer).
Still open below: cash rounding, e-invoice formats.

A claim: `out` = we issued it (receivable), `in` = we received it (payable). Works without
bookkeeping; needs `fin.payment`, because "paid" means payments with its `ref`.

Table `invoice`: `direction`, `number`, `date`, `due`, `currency`, `net`, `tax`, `total`, `paid`,
`status` (`draft | open | paid | canceled`; overdue is derived from `due`), `ref` (what it is for),
party as a **snapshot** (name, address, tax id, bank details for `in`) plus optional `usr_id`, `file_id` (the PDF
as dbFile), `data`.

Table `invoice_line`: `sort`, `name`, `description`, `quantity`, `price`, `tax_rate`, `amount`. Tax per line, totals
per rate; no tax tables — the consumer passes the rate (VAT, GST, sales tax alike). Cash rounding
as an option per currency (CHF, SEK, DKK … round to more than one minor unit).

- Numbers: per direction a counter with a format (`R-{year}-{n}`), drawn in the transaction that
  leaves `draft`. `in` keeps the sender's number.
- `paid` / `status` follow `payment:change` for payments with `ref = fin.invoice:<id>`;
  partial payments add up.
- PDF: HTML template → [`pdf`](#pdf); the open slip of each pending payment (QR bill) is appended.
- Later: `fin.invoice.reminder` (dunning via cron + messaging); e-invoice formats as children
  (EN 16931: Factur-X/ZUGFeRD, XRechnung, Peppol UBL); reading incoming invoices (`in`) from a PDF
  or photo — each format in its module, `qrbill` reads QR bills.

## fin.bank

**Built**, with `fin.bank.camt` (camt.053/054) — see its [README](fin.bank/README.md).
Matching is built in (reference = payment's `external_id`), so no `bank:transaction` event yet.

What the bank says. Without it, `qrbill` and `transfer` can only be settled by hand (`record`).

Tables: `bank_account` (identifier: IBAN, or account and routing number; currency, label), `bank_tx` (account, booking date, value date, signed
amount, currency, reference, counterparty name/account, text, `external_id` = bank's id for dedupe,
`payment_id` once matched).

- Import is idempotent (by `external_id`), so overlapping statements are harmless.
- After import fires `bank:transaction`; providers waiting on the bank match their references and
  sync. What nobody claims is listed for manual assignment (→ `record`), with suggestions by
  amount and name.
- Importers as children: `camt` (ISO 20022 camt.053/054 upload — first, standard across Europe
  and beyond), `ebics` (automatic fetch, CH/DE/FR/AT), national open-banking APIs in their own
  modules (`blink` for CH, PSD2 aggregators for the EU), CSV for PayPal and the like.
- "bank" as in Xero/QuickBooks: any account with statements — bank, PayPal, cash book, crypto
  wallet. A payment provider like `bitcoin` asks the chain itself and needs no bank; a wallet
  importer is only for bookkeeping.

## fin.wallet

**Built** as `fin.payment.credit` (table `payment_credit`, provider `credit`) — a payment provider
like the others, so it is named after the payment family; see its
[README](fin.payment.credit/README.md).

A user's credit: prepaid, credit notes instead of refunds, payouts to partners. Not a column on
`usr` (several currencies, no history) and not a stored balance (no trace, concurrent writes
overwrite each other), but a ledger:

```
wallet_tx(id, usr_id, currency, amount ±, ref, time)
balance = SUM(amount) per usr_id + currency   — a cached sum only if it gets slow
```

It is also the payment provider `wallet`: paying with credit is a payment `in` that debits the
ledger, a credit note or payout is a payment `out` that credits it. Shop and invoice need no
special code. Name: `wallet` reads well for users; close to crypto wallets, but those are
`fin.bank` accounts here.

## pdf

**Built** in [qino/module/pdf](../module/pdf/).

HTML in, PDF bytes out — templates and identity CSS exist only once. No library: headless Chromium
via `Deno.Command` (`--headless --print-to-pdf`). Chrome handles `@page` margins, header/footer
boxes and page numbers, enough for invoices. Cost: Chromium on the server, ~100 MB per render for a
moment. Fallback if Chromium isn't possible: Typst (single binary, own template language). A
provider's slip comes as SVG and fits into the HTML (`qrbill` uses `swissqrbill`).

## fin.accounting

**Built**, minimal, with `fin.accounting.ch` (SME chart, roles) — see its
[README](fin.accounting/README.md), which lists the decisions that may change (one signed
amount per line, one currency per book, no carry-over entries).
Built since: an account per invoice line, tax codes (the rate) on every automatic line, closing a
business year onto equity (`close`, `reopen`); the Swiss VAT return, effective and net tax rate
method (`fin.accounting.ch`); the export for the fiduciary (a backend page, ZIP with CSV and
receipts). Decided: no carry-over into a new year — the book runs on.

Double entry, country-neutral.

- `accounting_account` — chart of accounts, never hard-coded; charts come from country modules
  (`fin.accounting.ch`: KMU chart, `.de`: SKR03/04 …), or are entered by hand.
- `accounting_entry` (date, text, `ref`, `year`) + `accounting_entry_line` (account, debit/credit
  amount, currency, rate, tax code). Balanced per entry, append-only; corrections are reversals.
- Receipts: `accounting_entry_file` → dbFile. Upload a receipt first, book it later is a normal flow.
- Years: open, close, carry-over (opening balances from the closing ones). A closed year takes no
  more entries.
- Automatic entries from events of linked modules (invoice issued, payment paid, fee, bank tx),
  through rules that map provider/method/tax to accounts. Without rules: nothing is booked, the
  backend lists what is open.
- Tax codes on lines are generic (code + rate); what a VAT report adds up is the country
  module's business (CH: effective and net tax rate method).
- Exports: CSV/journal for the accountant; national formats (DATEV, SAF-T, …) in country modules.

## Backend

**Built**: `cms.backend.superuser.fin` (overview: what is open, how the parts work together, the
linked fin modules read from their manifests) with `.payment` (journal, detail with provider state,
bank lines and slip, refund, record by hand, provider settings), `.invoice` (list, detail with lines,
payments, document preview and PDF, new drafts, settings) and `.bank` (accounts, camt upload, lines,
assign with suggestions). Demo data: seeder `fin` in `test-modules/cms.backend.demo`.
Built since: `.invoice.inbox` (received invoices read by a language model, supplier found or
created), `.party` (customers and suppliers derived from the invoices, address, IBAN, credit),
`.subscription` (subscriptions, plans, billing run), `.accounting.export`; status badges in colour,
texts in the namespace `fin` (`languages.with`), five languages.

## Open

Next, by use:

- Out payments: open received invoices as a pain.001 file for the bank (`send`); the suppliers'
  IBANs are there (`usr.iban`).
- "Sent on" on the invoice, not only in the message journal; sending on issue, as a setting.
- Credit: paying part of a payment with it; booking money that comes in for credit.
- A default account per supplier; reminder fees as an invoice of their own; several items per
  subscription, proration.
- E-invoice formats (Factur-X/ZUGFeRD, XRechnung, Peppol UBL); export formats of single programs
  (Banana, Abacus, DATEV) — each a module of its own, once needed.
- Cash rounding per currency; stablecoins.

Uncertain, to be decided when it matters:

- Parties are users (`usr`, suppliers without a login). A contacts table of its own only once
  users no longer fit.
- One postal address per user; a billing or delivery address that differs lives on the invoice or
  order.
- One price per subscription, no proration; canceled invoices keep their subscription periods.
- Multi-currency books (functional currency, revaluation) — only when needed.
- Credit notes without an invoice, and credit notes from suppliers.
- Translations: only languages the site has (`languages.all`) — an invoice in another language
  falls back to the default one, until smalltext stores rows instead of a column per language.
- Texts of the browser scripts (`pub/*.js`) still translate in the core namespace.
- Browser files import each other across a store by relative path (`../../cms.backend.superuser.fin`):
  fine within one store; across stores a core question.

Before going live on a server: `fc-match Arial` must give Liberation Sans or Arial (QR bill font).

Decisions that may change, module by module, are in each README ("Decisions that may change").
