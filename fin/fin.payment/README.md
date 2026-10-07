# fin.payment

**Money that moved, or is about to.** One table, one status, one event. What it is paid for — an
order, an invoice, a donation — stays with the consumer, which only leaves a `ref`.

```ts
import { create, methods } from "@qino/qino/fin.payment";

await methods(app, { amount: 4990, currency: "CHF", country: "CH" });
// [{ method: "saferpay.twint", label: "TWINT" }, …]

const { redirect } = await create(app, {
  amount: 4990, // minor units
  currency: "CHF",
  method: "saferpay.twint", // or just "saferpay": the payer chooses there
  ref: "shop.order:123",
  return: "/checkout/done",
});
throw new Redirect(redirect);

app.on("payment:status", ({ payment }) => {
  if (payment.status === "paid" && String(payment.ref).startsWith("shop.order:")) complete(payment);
});
```

`payment:status` fires once per change, no matter who noticed it first. `return` is where the payer
lands, paid or not, so the page there reads the row and shows what it says.

What happened without a provider — cash, a bank transfer assigned by hand — is recorded, in either
direction; it fires the same event:

```ts
await record(app, { direction: "in", provider: "cash", amount: 2000, currency: "EUR", ref: "fin.invoice:7" });
```

## Status

`pending` → `processing` (seen, not yet confirmed: crypto, some wallets) → `paid`, later maybe
`refunded`. `failed`, `canceled` and `expired` end a payment unpaid. `paid`, `refunded` and `fee` are
amounts too: crypto may bring more or less than `amount`, a refund may be partial and leave it
`paid`, `fee` is what the provider kept.

`direction` is `in` or `out`. Providers start incoming payments only, so far; outgoing ones are
recorded.

## Providers

A module declares `export const paymentProvider` (type `Provider`): `methods`, `start`, `sync`, and
optionally `refund`, which only pays back — the refunded total and the status follow from the amount.
A method with an empty name stands for the provider itself (`saferpay`: the payer chooses there).
[fin.payment.saferpay](../fin.payment.saferpay/) is one.

`sync` asks the provider and is the only source of truth. The payer's return
(`payment/return/<token>`) and the provider's notification (`payment/notify/<token>`, both handed
to `start`) only trigger it, so nothing a browser or webhook sends needs to be trusted. The tokens
are signed: nobody reaches someone else's payment by counting through ids.

A notification can get lost, so a job asks after open payments for two days — a safety net, not
polling: each ask waits as long as the payment was old at the last one, about ten asks in all.
