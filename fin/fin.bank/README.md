# fin.bank

**What the bank says.** Accounts and the lines of their statements, each stored once. A line
whose reference belongs to a [payment](../fin.payment/) settles it; the rest waits to be assigned.

"Bank" as in most bookkeeping software: any account with statements — a bank account, a PayPal
balance, a cash book, a wallet.

```ts
import { assign, ingest } from "@qino/qino/fin.bank";

await ingest(app, {
  account: "CH93 0076 2011 6238 5295 7",
  currency: "CHF",
  transactions: [
    { id: "2026100700012", date: "2026-10-07", amount: 47226, reference: "21 00000 00003 13947 14300 09017" },
    { id: "2026100700013", date: "2026-10-07", amount: -12000, partyName: "Hosting AG", text: "Rechnung 778" },
  ],
}); // { added: 2, matched: 1 }

await assign(app, txId, "fin.invoice:7"); // the second line, by hand
```

Importers turn a format into this shape and call `ingest`: [fin.bank.camt](../fin.bank.camt/) reads
ISO 20022 camt.053/054, the format banks across Europe export.

## Matching

A line's `reference` (QR reference, creditor reference `RF…`, end-to-end id) is compared — without
spaces and case — with the payments' `external_id`, in the direction of its sign. A match links
the line and syncs the payment; its provider asks `paid(app, paymentId)` what arrived, so two
partial transfers on one QR bill add up. Payments stay the only place a status lives.

A line without a match is assigned with `assign(app, txId, ref)`: it becomes a recorded payment
(`provider` `bank`) for whatever `ref` names — an invoice, an order.

A statement read twice adds nothing: each line is stored under the bank's own id for it, with the
account. Accounts are created from the statements themselves.
