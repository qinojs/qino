# fin.payment.btcpay

[BTCPay Server](https://btcpayserver.org) as a [payment](../fin.payment/) provider: bitcoin
on-chain, Lightning, and whatever else the store has enabled — self-hosted, without a middleman.

Settings (`fin.payment.btcpay`): `url` of the server, `storeId`, a Greenfield `apiKey` that can
view and create invoices, and the `webhookSecret` of a store webhook pointing at
`<site>/payment/webhook/btcpay`.

`start` creates an invoice in the payment's currency and sends the payer to BTCPay's checkout,
which sends them back. `sync` reads the invoice: New → pending, Processing → processing (seen,
waiting for confirmations), Settled → paid, Expired → expired, Invalid → failed. `paid` is
BTCPay's `paidAmount` in the payment's currency.

The webhook is checked against `BTCPay-Sig` and only says which invoice; the status is then asked.

## Decisions that may change

- **Expired with money in it** (paid in part, or too late) stays `processing`: someone has to
  decide whether the rest is asked for or the money returned. BTCPay's refunds (pull payments) are
  not built.
- **One method** (`btcpay`): the payer chooses on/off-chain on BTCPay's checkout. Fixing it per
  call (`checkout.paymentMethods`) would make one method per payment method.
