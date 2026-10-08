# fin.accounting.ch

Swiss bookkeeping for [fin.accounting](../fin.accounting/). Installing it adds the main accounts of
the Swiss SME chart (Kontenrahmen KMU) — not all of them, the ones a small business books on —
and, where nothing is set yet, the accounts automatic entries use. The book keeps the main currency
([fin](../fin/)): CHF for an organization in Switzerland; where none follows, installing sets CHF.

| Role | Account |
|---|---|
| receivable / payable | 1100 / 2000 |
| revenue / expense | 3400 / 4400 |
| tax due / input tax | 2200 / 1170 |
| fees | 6940 |
| money | 1020 bank; cash 1000, Saferpay 1091, credit 2030 |
| result (closing) | 2979; a sole proprietorship sets 2800 |

Accounts are only added or renamed, never removed. More accounts: `account(app, number, …)` or
the backend.

## VAT return

`vatReturn(app, { from, to })` adds up the books of a period by tax code — automatic entries give
every line its rate — into the figures of the Swiss form: turnover (200), exempt or abroad (220),
turnover and tax per rate (302/303, 312/313, 342/343), input tax (400), payable (500) or credit
(510). With `fin.accounting.ch.vat.method` "saldo" it is the turnover with tax at the net tax rate
(`vat.rate`, 322), without input tax. The accounting backend shows it for the period chosen.

## Decisions that may change

- **One net tax rate.** A business with two (saldo method) or with figures 205, 221, 280, 405 …
  (deductions, investment input tax) fills those in by hand.
- **Tax codes are the rates** (`8.1`), not codes of their own: a manual entry counts once it
  carries one.

Not yet: exports for the fiduciary.
