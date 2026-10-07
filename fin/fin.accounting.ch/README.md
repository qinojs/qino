# fin.accounting.ch

Swiss bookkeeping for [fin.accounting](../fin.accounting/). Installing it adds the main accounts of
the Swiss SME chart (Kontenrahmen KMU) — not all of them, the ones a small business books on —
and, where nothing is set yet, the book's currency (CHF) and the accounts automatic entries use:

| Role | Account |
|---|---|
| receivable / payable | 1100 / 2000 |
| revenue / expense | 3400 / 4400 |
| tax due / input tax | 2200 / 1170 |
| fees | 6940 |
| money | 1020 bank; cash 1000, Saferpay 1091 |

Accounts are only added or renamed, never removed. More accounts: `account(app, number, …)` or
the backend.

Not yet: the VAT report (effective and net tax rate method), exports for the fiduciary.
