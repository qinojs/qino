# fin

The base of the `fin.*` modules. It carries

- the **postal address of users** — `usr.street_address`, `postal_code`, `address_locality`,
  `address_region`, `address_country` (schema.org PostalAddress): where an invoice goes. An invoice
  keeps its own copy (`party`), as it was when issued;
- the **texts payers and recipients read** — the invoice document, payment pages — in the
  translation namespace `fin` (`locale/`), translated once for all of them.

## Decisions that may change

- **One address per user.** A billing or delivery address that differs belongs to the invoice or
  order that needs it; a second one on the user only once someone needs it.
- **Little code, so far.** What else the modules share (the `ref` convention, minor units) moves
  here once a second module needs it as code.
- **Backend pages** translate in their own namespace, as every backend page does.
