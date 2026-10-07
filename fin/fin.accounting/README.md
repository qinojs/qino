# fin.accounting

**Double entry, minimal.** Accounts, entries whose lines add up to zero, receipts, closed periods.
Invoices and payments book themselves; anything else is booked by hand or by its module.

```ts
import { balances, book, reverse } from "@qino/qino/fin.accounting";

await book(app, {
  date: "2026-10-07",
  text: "Office rent October",
  lines: [{ account: "6000", amount: 180000 }, { account: "1020", amount: -180000 }], // debit +, credit −
  files: [receipt], // dbFiles
});
await reverse(app, id); // a mistake is taken back, never edited
await balances(app, { from: "2026-01-01", to: "2026-12-31" }); // every account with its balance
```

The chart comes from a country module — [fin.accounting.ch](../fin.accounting.ch/) for the Swiss
SME chart — or is kept by hand with `account(app, number, { name, type })`. The five types (asset,
liability, equity, income, expense) are the same everywhere.

## Automatic entries

Settings `fin.accounting.accounts.*` name an account per role; a country module fills them in.

| When | Debit | Credit |
|---|---|---|
| invoice issued | receivable | revenue, tax due |
| invoice received | expense, input tax | payable |
| money in for an issued invoice | money (less fee), fees | receivable |
| money out for a received invoice | payable, fees | money |
| invoice canceled | its entry is reversed | |

A payment is booked as the difference to what is booked for it already (`ref` `fin.payment:<id>`),
so partial payments, refunds and fees add up whenever `payment:change` fires. A failed automatic
entry (closed period, missing account) is logged and never stops the invoice or the payment.

## Decisions that may change

- **One signed amount per line** (debit +, credit −) instead of two columns: a balance is a sum.
  The backend shows debit and credit apart.
- **One currency per book** (`fin.accounting.currency`). Invoices and payments in another currency
  are not booked automatically; booking them needs rates at the booking date — not built.
- **No carry-over entries.** Balance-sheet accounts are summed over all time, income and expense
  over the period asked for; closing a year is setting `closedUntil` and booking the result to
  equity by hand. Separate books per year would need opening entries.
- **Tax in one line** per invoice, without a code per rate; a VAT report per rate would read the
  invoice lines, or the entries need a tax code per rate.
- **Only payments for invoices** are booked automatically: for anything else (a shop order, a
  donation) the consumer knows the account.
- **Accounts are never deleted** with their lines; there is no delete in the API.
