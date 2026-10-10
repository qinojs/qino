# cms.backend.superuser.fin.party

Customers and suppliers: the users invoices are for or from. Who is which follows from the
invoices — issued to someone makes a customer, received from someone a supplier, both is fine —
so there is nothing to keep in step. The list shows what is open both ways — a credit note still
open counts against the claim — and, with [fin.payment.credit](../fin.payment.credit/), the credit
each holds. A party's page keeps its name, postal address and IBAN (the `usr` columns of the module
`fin`), lists its invoices, and shows its credit with a form to add to it. New invoices take the
address over in the invoice editor.

## Decisions that may change

- **Parties are users.** A supplier is created as a user without a login (`active` 0, no
  password). A contacts table of its own (as Odoo or Bexio keep) only once users no longer fit.
- **Only parties with a user are listed.** An invoice whose party is only its copy (`party`,
  no `usr_id`) does not show here; neither does a new party until its first invoice.
