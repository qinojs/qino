# fin.payment.qrbill

The **Swiss QR bill** as a [payment](../fin.payment/) provider. The payer scans the slip in their
e-banking or pays at the counter; the bank statement settles it.

```ts
const { redirect } = await create(app, {
  method: "qrbill", amount: 47226, currency: "CHF", ref: refOf(invoiceId), description: "Rechnung 2026-1", return: "/",
}); // redirect: payment/pay/<token>, the slip
```

Setting `fin.payment.qrbill.iban` is the account paid into; the creditor (name, address) is
`identity.organization`. Offered for CHF and EUR once the IBAN is set.

## Reference and settling

A **QR-IBAN** (institution id 30000–31999) takes a QR reference: the payment id in 26 digits and a
mod-10 check digit. A **normal IBAN** takes an ISO 11649 creditor reference, `RF` and two check
digits. Either is the payment's `external_id`.

[fin.bank](../fin.bank/) matches a statement line by that reference and syncs the payment; the
provider asks the bank what arrived. Less than the amount: `processing`, and the slip asks for the
rest; all of it: `paid`. Without bank statements a QR bill is settled by hand there (`assign`).

## The slip

`slip` is the payment part with receipt as SVG (by [swissqrbill](https://github.com/schoero/swissqrbill)),
in the language of the request or the site — German, French, Italian, else English. It shows at the
payment's `pay` address, and an [invoice](../fin.invoice/) prints it on a page of its own with the
open amount. The debtor is the payment's `payer` — an invoice's party — where its address is
whole (street, postal code, place; the country is the creditor's if it names none), as the standard
asks for a structured address; else the field is left blank, to be filled in by hand. The font is
Arial: the server needs Arial or Liberation Sans (`fc-match Arial`), the fonts the standard allows.
