# fin

The base of the `fin.*` modules. It carries

- the **postal address of users** — `usr.street_address`, `postal_code`, `address_locality`,
  `address_region`, `address_country` (schema.org PostalAddress): where an invoice goes. An invoice
  keeps its own copy (`party`), as it was when issued. And `usr.iban`, the account to pay them;
- the **texts payers and recipients read** — the invoice document, payment pages — in the
  translation namespace `fin` (`locale/`), translated once for all of them;
- the **main currency** (`fin.mainCurrency`): the books keep it, new forms suggest it. Empty, it is
  the currency of the country the organization is in (`identity`), so a Swiss site has CHF
  without setting anything. `mainCurrency(app)` reads it;
- the **helpers they share** (`mod.ts`): days on the server's calendar (`today`, `addDays`,
  `addMonths`), amounts to and from minor units (`toMinor`, `fromMinor`), a user as an invoice's
  party (`partyOf`, `nameOf`).

## API

Each fin module has an `api` (its interfaces, tools for agents), without the CMS: a **superuser**
does anything, a **signed-in user** reads what is theirs (`usr_id`) — someone else's answers "not
found". Paid is what a provider or the bank says, never the payer. The backend pages are the CMS's:
whoever reaches them acts there, through `mod.ts`.

| Module | A user | A superuser, too |
|---|---|---|
| `fin` | `address`: read, change (not the IBAN) | anyone's, the IBAN |
| `fin.invoice` | issued ones: `invoices`, `invoice/:id`, `pdf`, `methods`, `pay` | drafts, `issue`, `cancel` … |
| `fin.payment` | `payments`, `payment/:id` | record, `sync`, `cancel`, `refund` |
| `fin.payment.credit` | balance and moves | add, take |
| `fin.subscription` | `subscriptions`, `subscription/:id`, `cancel`, `plans` | subscribe, change, plans, `bill` |
| `fin.accounting`, `fin.bank` … | — | entries, `reverse`, `close`, VAT, lines, `assign`, camt |

## Decisions that may change

- **Rights: superuser or owner.** Groups per area (read, manage) — a fiduciary who books, an
  auditor who reads — once someone needs them.

- **One address per user.** A billing or delivery address that differs belongs to the invoice or
  order that needs it; a second one on the user only once someone needs it.
- **Little code, so far.** What else the modules share (the `ref` convention) moves here once a
  second module needs it as code.
- **Backend pages** translate in their own namespace, as every backend page does.
