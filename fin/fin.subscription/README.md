# fin.subscription

Subscriptions: what a user is billed for again and again — a hosting, a domain, a membership —
period by period, in advance. A subscription has a price per period, a period of months or years
(`interval_unit`, `interval_count`: 1 year, 3 months), a `start_date` and, once canceled, an
`end_date`. A user may have several, of the same kind too (two domains).

```ts
import { bill, cancel, plan, subscribe, update } from "@qino/qino/fin.subscription";

const light = await plan(app, { name: "Hosting Light", price: 24000, currency: "CHF" });
await subscribe(app, { usrId: 42, planId: light, name: "example.ch", start: "2027-03-01" });
await subscribe(app, { usrId: 42, name: "Domain example.ch", price: 2500, currency: "CHF", start: "2027-03-15" });
await bill(app); // what renews within the lead time, one invoice per user and currency
await update(app, id, { price: 22000 }); // from the next period
await cancel(app, id); // ends with the period under way
```

**Plans** (`subscription_plan`) are the catalog: name, description, price, currency, tax, period.
A subscription of a plan takes from it what it leaves empty — price, currency, tax, period,
description — and its own `name` becomes the detail (example.ch). A new price in the plan applies
to its subscriptions from their next period. Without a plan, a subscription says it all itself.

A daily job bills what begins within `fin.subscription.lead` days (30): per user and currency one
invoice, a line per period — the plan's name, or the subscription's; as description the detail
and the period, below it what it includes —, so a customer's hosting and domain come on one
invoice. The invoices are drafts to look at, issued at once with `fin.subscription.issue`, or
issued and mailed to the customer with `fin.subscription.send` (where `messaging.email` is
installed; nothing is mailed otherwise). From there on they are invoices like any other: sent,
paid, reminded, booked.

`subscription_invoice` keeps which period went on which invoice; the next period follows from the
last one billed. Throwing a draft away takes its periods with it, and they are billed again.
`update()` changes plan, name, price, tax, period and end from the next period; the start only
while nothing was billed.

## Decisions that may change

- **One price per subscription.** Several items per subscription (as Stripe has) only once needed.
- **No proration.** A change applies from the next period; canceling ends with the period under way.
- **A canceled invoice keeps its periods billed**: to bill them again, throw the draft away before
  issuing, or bill by hand.
- **Plans live here.** Were there a product catalog one day, they would go into it.
