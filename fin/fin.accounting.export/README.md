# fin.accounting.export

The books of a period for the fiduciary, as one ZIP that any bookkeeping software or spreadsheet
reads: `exportBooks(app, { from, to })`.

- `journal.csv` — one row per entry line: date, entry, text, account, debit and credit apart, tax
  code, currency, reference, the entry it reverses, its receipts;
- `balances.csv` — every account with its balance (the balance sheet up to `to`, the result of
  the period);
- `receipts/` — the receipts, named by their entry: `12-Miete_Oktober.pdf`.

CSV with semicolons and a byte order mark, as spreadsheets in most of Europe expect; amounts with
a point and the book currency's decimals. The accounting backend has a button for the period shown.

## Decisions that may change

- **One neutral format.** Formats of particular software (Banana, Abacus, DATEV) would be modules
  of their own next to it.
- **Built in memory.** A very large period with many receipts would want a streamed ZIP.
