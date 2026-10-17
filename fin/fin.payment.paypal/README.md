# fin.payment.paypal

**PayPal** as a [payment](../fin.payment/) provider, through the Orders API v2: the payer
approves on PayPal, comes back, and the order is captured then.

Settings (`fin.payment.paypal`): `clientId` and `secret` of a REST app, `live` for live payments
(the sandbox otherwise). A webhook may point at `<site>/payment/webhook/paypal`.

`start` creates an order and sends the payer to PayPal; the way back is the payment's `return`,
which syncs: an approved order is captured — `paid` with PayPal's fee, or `processing` while the
capture is pending; a voided order is `canceled`. `refund` refunds through the capture.

## Decisions that may change

- **The webhook is only a hint**: it names the order, which is then asked. PayPal's signature
  check (an API call per event) is not built; a forged event can only make the order be asked.
- **A new access token per call** — one request more each time, nothing to keep between them.
- **Orders nobody approves** stay `pending`; PayPal forgets them after a few hours.
