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
| losses (written off) | 3805 |
| money | 1020 bank; cash 1000, Saferpay 1091, credit 2030 |
| result (closing) | 2979; a sole proprietorship sets 2800 |

Accounts are only added or renamed, never removed. More accounts: `account(app, number, …)` or
the backend.

## VAT return

`vatReturn(app, { from, to })` adds up the books of a period by tax code — automatic entries give
every line its category and rate — into the figures of the Swiss form:

| Category | Figure |
|---|---|
| `S` | turnover and tax per rate: 302/303, 312/313, 342/343 |
| `G`, `K`, `Z` | 220, exempt (exports) |
| `AE` | 221, services abroad |
| `E` | 230, excluded |
| `O` | no turnover (default interest, damages) |

A loss written off (on `accounts.losses`) is a reduction of consideration, 235, taken off the
turnover of its category and rate. Turnover (200) is all of them but `O`. Input tax goes to 400, or to 405 where its entry books onto
an asset account (an investment); payable (500) or credit (510). With
`fin.accounting.ch.vat.method` "saldo" it is the taxed turnover with tax at the net tax rate
(`vat.rate`, 322), without input tax. The accounting backend shows it for the period chosen. The
mapping is in [LAW-CH.md](../LAW-CH.md).

## Decisions that may change

- **One net tax rate.** A business with two (saldo method), or with figures 205, 280, 410, 415 …,
  fills those in by hand.
- **Reverse charge on purchases** (Bezugsteuer, 382/383) is not computed: a received invoice with
  `AE` lines carries no tax to add up.
- **Agreed consideration** (vereinbart) only: tax counts when invoiced. Received consideration
  (vereinnahmt, MWSTG 39 II) is not built.
- **Tax codes are category and rate** (`S8.1`): a manual entry counts once it carries one.

Not yet: exports for the fiduciary.
