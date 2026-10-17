# fin.payment.saferpay

[Saferpay](https://saferpay.github.io/jsonapi/) (Worldline) as a [payment](../fin.payment/) provider,
through the Payment Page: the payer pays on Saferpay's page and comes back.

```ts
await create(app, { method: "saferpay.twint", amount: 4990, currency: "CHF", ref: "shop.order:12", return: "/done" });
await create(app, { method: "saferpay", … }); // the payer chooses on Saferpay's page
```

Settings (`fin.payment.saferpay`): `customerId`, `terminalId`, `user` and `password` of a JSON API
user, `live` for production (the test environment otherwise), and `methods` — the Saferpay names
(`TWINT, VISA, MASTERCARD` …) to offer one by one. Without `methods` there is one method, `saferpay`,
and the payer chooses there.

## Flow

`start` initializes the Payment Page and keeps its token. On the payer's return and on Saferpay's
notification, `sync` asserts the token and captures an authorized payment at once; a payment
Saferpay already captured is just taken over. Payer-side refusals (declined, aborted, expired)
end the payment; refusals that are ours (credentials, validation) are thrown and show in the log.

Saferpay asks not to poll Assert. Return and notification come first; the payment module's job
asks after open payments only with growing gaps.

A refund is authorized and then captured, as Saferpay requires.

Not yet: reservations captured later (an order checked first), Saferpay Fields, saved cards.
