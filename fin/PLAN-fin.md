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

## Built

Each module documents itself in its README: [fin](fin/README.md),
[fin.payment](fin.payment/README.md) with the providers `saferpay`, `btcpay`, `bitcoin`, `lightning`,
`qrbill`, `stripe`, `paypal` and `credit` (a user's credit as a ledger),
[fin.invoice](fin.invoice/README.md) with `.reminder`, [fin.subscription](fin.subscription/README.md),
[fin.bank](fin.bank/README.md) with `.camt`, [fin.accounting](fin.accounting/README.md) with `.ch`,
[fin.hosting](fin.hosting/README.md), and the backend `cms.backend.fin.*`.
PDF rendering is the core module [pdf](../module/pdf/), not finance.

Dependencies only point down: `fin.invoice`, `fin.bank` and the providers → `fin.payment`; `qrbill` →
`fin.bank`, which settles it; `fin.accounting` → `fin.invoice`, `fin.payment`.

## Open

Next, by use:

- Out payments: open received invoices as a pain.001 file for the bank (`send`); the suppliers'
  IBANs are there (`usr.iban`).
- "Sent on" on the invoice, not only in the message journal; sending on issue, as a setting.
- Out payments also need a release step before `send`: plain module access (access = usage); amount
  limits and four eyes only when someone needs them.
- Providers `transfer` (bank transfer, reference in the message, matched like `qrbill`) and `pain001`
  (ISO 20022 payment order file, confirmed by the debit in the statement).
- Bank importers: `ebics`, national open-banking APIs (`blink` for CH, PSD2 aggregators), CSV for
  PayPal and the like; a `bank:transaction` event once a second consumer needs it.
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
- Two main currencies: fin's (`fin.mainCurrency`, else the organization's country's) and the
  shop's (`shp3_currency.main`, a table kept compatible with the PHP shop). The shop could follow
  fin's once it builds on it.
- Credit notes without an invoice, and credit notes from suppliers.
- Translations: only languages the site has (`languages.all`) — an invoice in another language
  falls back to the default one, until smalltext stores rows instead of a column per language.
- Texts of the browser scripts (`pub/*.js`) still translate in the core namespace.
- Browser files import each other across a store by relative path (`../../cms.backend.fin`):
  fine within one store; across stores a core question.

Before going live on a server: `fc-match Arial` must give Liberation Sans or Arial (QR bill font).

### From the code review (2026-10)

Found, not yet done — to be checked before acting on them.

Structure:

- Subscriptions: deleting a plan or a never billed subscription lives in the backend api; belongs
  to `fin.subscription` (its errors then translated in the backend).
- The party and subscription backend apis lack the `try … errMsg` the others have.
- Settings defaults repeated in code (`?? 30`, `|| "{year}-{n}"`, the mempool URL): needed today,
  since leaf reads (and `fakeSettings` in the tests) do not apply schema defaults. A core question.
- Still copied in the backend pages: `option()`, `field()`, the overdue count (overview and invoice
  widget), the user picker query. The accounting journal with `PER_PAGE + 1` instead of `pager()`.
- Accounting widget and overview default to the calendar year, though the business year may end
  on any day (`close()`).
- `dataOf(payment)` in five providers; `Urls` in `fin.payment/mod.ts` repeats `lib/url.ts`.
- Saferpay `sync` returns the raw answer as state when it has no transaction.
- The inbox's `Read` type repeats its `SCHEMA`.
- `fin.invoice:` still written by hand in the bank suggestions and `refLink`.

Decisions that may change, module by module, are in each README ("Decisions that may change").
