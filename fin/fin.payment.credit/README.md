# fin.payment.credit

Credit — a balance a user holds with us, from a prepayment, an overpayment or a goodwill — and
paying with it. It is a payment provider like any other (`credit`): offered where the user has
enough credit in the currency, paid at once from the balance, and refunded back onto it. So an
invoice, a shop order or anything else asking for a payment can be paid with credit, and what
follows — the invoice paid, the entry booked — follows as for any payment.

```ts
import { add, balance } from "@qino/qino/fin.payment.credit";

await add(app, 42, { amount: 5000, currency: "CHF", text: "Goodwill" });
await balance(app, 42, "CHF"); // 5000
await create(app, { method: "credit", amount: 3000, currency: "CHF", usrId: 42, ref, return: "/" });
```

What we owe someone — the rest of a credit note — is paid out onto their credit with `payOut()`: an
outgoing payment (`credit`) for its `ref`, and the credit it adds, in one go.

Every move is a row (`payment_credit`): added positive, spent negative; the balance is their sum,
and never goes below zero.

## Decisions that may change

- **Only the whole amount.** Credit is offered only where it covers the payment; paying part
  with credit and the rest otherwise is not built.
- **Adding credit books nothing.** Money that comes in for credit (cash, a transfer) is booked by
  hand; paying with credit books on the account `moneyBy` names for `credit` — a liability such as
  customer prepayments — else on `money`.
