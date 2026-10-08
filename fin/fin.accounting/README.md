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

An invoice line may name its own account (`invoice_line.account`, a column this module adds):
revenue or expense is then split by the accounts of the lines, the rest on the role's account; tax
stays per rate on its account. With prices including tax, a line's net is taken out by its rate,
and the last account takes the rounding.

The invoice's file goes with its entry as receipt — the original of a received invoice. A file
attached after the invoice was booked is not added to the entry (yet).

A payment is booked as the difference to what is booked for it already (`ref` `fin.payment:<id>`),
so partial payments, refunds and fees add up whenever `payment:change` fires. A failed automatic
entry (closed period, missing account) is logged and never stops the invoice or the payment.

## Closing a year

`close(app, until)` closes the business year that ends on `until` — any day, not only the 31st
of December: income and expense since the last closing go to the result account
(`accounts.result`, equity; 2979 in Switzerland, 2800 for a sole proprietorship) in one entry
(`ref` `fin.accounting:close:<until>`), and the books are closed up to that day. The result of a
closed year still shows: `balances(app, { from, to, closings: false })` leaves the closing out.
`reopen(app)` opens the last closed year again and takes its closing entry back on its own day.

There is no carry-over into the new year: the book runs on, the balance sheet adds up all that
came before. The accounting backend lists what is still open in the year (drafts, unassigned
bank lines, entries by hand without a receipt) and closes it. Accruals, depreciation, the
appropriation of the result and the VAT reconciliation are booked by hand.

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
