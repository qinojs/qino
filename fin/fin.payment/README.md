# fin.payment

**Money that moved, or is about to.** One table, one status, one event. What it is paid for — an
order, an invoice, a donation — stays with the consumer, which only leaves a `ref`.

```ts
import { create, methods } from "@qino/qino/fin.payment";

await methods(app, { amount: 4990, currency: "CHF", country: "CH", usrId: 42 }); // usrId: credit is theirs
// [{ method: "saferpay.twint", label: "TWINT" }, …]

const { redirect } = await create(app, {
  amount: 4990, // minor units
  currency: "CHF",
  method: "saferpay.twint", // or just "saferpay": the payer chooses there
  ref: "shop.order:123",
  description: "Order 123", // shown to the payer by the provider
  payer: {
    name: "Anna Muster",
    address: { streetAddress: "Seeweg 2", postalCode: "3000", addressLocality: "Bern" },
  },
  return: "/checkout/done",
});
throw new Redirect(redirect);

app.on("payment:change", ({ payment }) => {
  if (payment.status === "paid" && String(payment.ref).startsWith("shop.order:")) complete(payment);
});
```

`payment:change` fires once per change — a new status, or money that moved (a second partial
transfer) — no matter who noticed it first. `return` is where the payer
lands, paid or not, so the page there reads the row and shows what it says.

What happened without a provider — cash, a bank transfer assigned by hand — is recorded, in either
direction; it fires the same event:

```ts
await record(app, { direction: "in", provider: "cash", amount: 2000, currency: "EUR", ref: "fin.invoice:7" });
```

`payer` is who pays, shaped like an invoice's party; a slip that has room for it prints it (the
QR bill's debtor). An invoice passes its party.

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

More, all optional: `slip` — what the payer needs outside a provider's page (a QR bill, an address
and its QR code; `qr(text)` draws one), shown at `payment/pay/<token>` and on invoices; `watch` —
that page asks again every few seconds and leads to `return` once paid (crypto); `webhook` — a
provider's notifications for all its payments at `payment/webhook/<name>`: it verifies them and
names the payments, which are then synced.

Providers: [saferpay](../fin.payment.saferpay/), [qrbill](../fin.payment.qrbill/),
[btcpay](../fin.payment.btcpay/), [lightning](../fin.payment.lightning/),
[bitcoin](../fin.payment.bitcoin/), [stripe](../fin.payment.stripe/), [paypal](../fin.payment.paypal/),
[credit](../fin.payment.credit/) (a user's credit with us).

`cancel(app, id)` withdraws a payment nobody has started paying (`pending`) — an invoice paid
another way does so with the ones still waiting for it.

`sync` asks the provider and is the only source of truth. The payer's return
(`payment/return/<token>`) and the provider's notification (`payment/notify/<token>`, both handed
to `start`) only trigger it, so nothing a browser or webhook sends needs to be trusted. The tokens
are signed: nobody reaches someone else's payment by counting through ids.

A notification can get lost, so a job asks after open payments for two days — a safety net, not
polling: each ask waits as long as the payment was old at the last one, about ten asks in all.
