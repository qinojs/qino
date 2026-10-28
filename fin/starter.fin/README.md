# starter.fin

Invoicing on top of [starter.account](../../module/starter.account/README.md).

- *Invoices* in the account area; the address invoices go to is kept under *Profile*.
- Invoices, payments and reminders, and the finance backend for the superuser.

Payment providers are left to the site: add `fin.payment.qrbill`, `fin.payment.stripe` or another
one from the fin store.
