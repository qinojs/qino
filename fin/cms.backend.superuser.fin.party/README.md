# cms.backend.superuser.fin.party

Customers and suppliers: the users invoices are for or from. Who is which follows from the
invoices — issued to someone makes a customer, received from someone a supplier, both is fine —
so there is nothing to keep in step. A party's page keeps its name and postal address (the `usr`
columns of the module `fin`) and lists its invoices; new invoices take that address over in the
invoice editor.

## Decisions that may change

- **Parties are users.** A supplier is created as a user without a login (`active` 0, no
  password). A contacts table of its own (as Odoo or Bexio keep) only once users no longer fit.
- **Only parties with a user are listed.** An invoice whose party is only its copy (`party`,
  no `usr_id`) does not show here; neither does a new party until its first invoice.
