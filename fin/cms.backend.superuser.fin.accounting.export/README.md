# cms.backend.superuser.fin.accounting.export

The books of a period for the fiduciary, as one ZIP that any bookkeeping software or spreadsheet
reads:

- `journal.csv` — one row per entry line: date, entry, text, account, debit and credit apart, tax
  code, currency, reference, the entry it reverses, its receipts;
- `balances.csv` — every account with its balance (the balance sheet up to the end, the result of
  the period);
- `receipts/` — the receipts, named by their entry: `12-Miete_Oktober.pdf`.

CSV with semicolons and a byte order mark, as spreadsheets in most of Europe expect; amounts with
a point and the book currency's decimals.

## Decisions that may change

- **The export lives in this page** (`lib/export.ts`). Once something else needs it — an API, a
  schedule — it moves into a module of its own, `fin.accounting.export`.
- **One neutral format.** Formats of particular software (Banana, Abacus, DATEV) would come next
  to it.
- **Built in memory.** A very large period with many receipts would want a streamed ZIP.
