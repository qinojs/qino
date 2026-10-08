# fin.subscription

Subscriptions: what a user is billed for again and again — a hosting, a domain, a membership —
period by period, in advance. A subscription has a price per period, a period of months or years
(`interval_unit`, `interval_count`: 1 year, 3 months), a `start_date` and, once canceled, an
`end_date`.

```ts
import { bill, cancel, subscribe } from "@qino/qino/fin.subscription";

await subscribe(app, { usrId: 42, name: "Hosting example.ch", price: 24000, currency: "CHF", start: "2027-03-01" });
await bill(app); // what renews within the lead time, one invoice per user and currency
await cancel(app, id); // ends with the period under way
```

A daily job bills what begins within `fin.subscription.lead` days (30): per user and currency one
invoice, a line per period with the period as its description — so a customer's hosting and
domain come on one invoice. The invoices are drafts to look at, issued at once with
`fin.subscription.issue`, or issued and mailed to the customer with `fin.subscription.send`
(where `messaging.email` is installed; nothing is mailed otherwise); from there on they are invoices like any other: sent, paid, reminded,
booked. `subscription_invoice` keeps which period went on which invoice; throwing a draft away
takes its periods with it, and they are billed again.

## Decisions that may change

- **One price per subscription.** Several items per subscription (as Stripe has) only once needed.
- **No proration.** A change applies from the next period; canceling ends with the period under way.
- **A canceled invoice keeps its periods billed**: to bill them again, throw the draft away before
  issuing, or bill by hand.
