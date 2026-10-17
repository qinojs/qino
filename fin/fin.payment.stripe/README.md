# fin.payment.stripe

[Stripe Checkout](https://docs.stripe.com/payments/checkout) as a [payment](../fin.payment/)
provider: the payer pays on Stripe's page with whatever the Stripe account offers — cards, TWINT,
Apple and Google Pay, SEPA and more.

Settings (`fin.payment.stripe`): the `secretKey` (`sk_test_…` or `sk_live_…` — the key decides
test or live) and the `webhookSecret` (`whsec_…`) of an endpoint pointing at
`<site>/payment/webhook/stripe` with `checkout.session.completed` and `.expired`.

`start` creates a session in minor units (Stripe's unit too) and sends the payer there; Stripe
sends them back through the payment's `return`. `sync` reads the session with its PaymentIntent:
paid → `paid` with the amount, what was refunded and Stripe's fee (when the balance is in the same
currency); expired → `expired`. `refund` refunds through the PaymentIntent. The webhook is checked
against `Stripe-Signature` and only names the payment.

## Decisions that may change

- **One method** (`stripe`): which payment methods show is set in the Stripe dashboard, not here.
- **Refunds made in the dashboard** are seen on the next `sync` of a payment still open, not on a
  paid one: a `charge.refunded` webhook would need the payment found by its PaymentIntent.
- **Stripe's own minor units** differ from ISO 4217 for a few currencies (e.g. ISK, HUF); those
  would need a conversion.
