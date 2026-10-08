# cms.backend.superuser.fin.invoice.inbox

Received invoices come in here: a PDF or a photo is read by a language model ([ai1](../../module/ai1/),
`structured`) into a draft received invoice, and the file becomes its receipt — the original,
kept unchanged. Every draft is checked in the invoice editor, beside the original, before it is
issued; the list marks a draft whose lines do not add up to the total that was read.

A PDF is given to the model as text — its own, or what OCR made of a scan (the file's `fmt=md`
transform) — else its pages as pictures; a photo as picture. Pictures need a model that can see
(`vision`). Which model reads is ai1's choice — in the backend as the signed-in user, so a model
tied to a user (a ChatGPT plan) reads too.

## Decisions that may change

- **The reading lives in this page** (`lib/read.ts`). Once something else needs it — invoices by
  mail, an API — it moves into a module of its own, `fin.invoice.read`.
- **At most 5 pages** of a PDF without text are shown as pictures.
- **No QR decoding**: a Swiss QR bill prints its account, amount and reference as text too, which
  the model reads. Decoding the code itself would make those exact.
- **The invoice goes to the model's provider** — keep that in mind with an external one.
