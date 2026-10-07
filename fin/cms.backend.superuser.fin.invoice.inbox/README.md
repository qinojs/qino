# cms.backend.superuser.fin.invoice.inbox

Received invoices come in here: a PDF or a photo is read by a language model ([ai1](../../module/ai1/),
`structured`) into a draft received invoice, and the file becomes its receipt — the original,
kept unchanged. Every draft is checked in the invoice editor, beside the original, before it is
issued; the list marks a draft whose lines do not add up to the total that was read.

A PDF's text is read ([unpdf](https://github.com/unjs/unpdf): pdf.js without native parts) and
given to the model as text; a photo is given as picture, so the model has to be able to see
(`vision`). Which model reads is ai1's choice — in the backend as the signed-in user, so a model
tied to a user (a ChatGPT plan) reads too.

## Decisions that may change

- **The reading lives in this page** (`lib/read.ts`). Once something else needs it — invoices by
  mail, an API — it moves into a module of its own, `fin.invoice.read`.
- **Scanned PDFs** (no text) are refused: their pages would have to become pictures first.
- **No QR decoding**: a Swiss QR bill prints its account, amount and reference as text too, which
  the model reads. Decoding the code itself would make those exact.
- **The invoice goes to the model's provider** — keep that in mind with an external one.
