# fin.payment.lightning

Bitcoin **Lightning** as a [payment](../fin.payment/) provider, through an
[LNbits](https://lnbits.com) wallet. Paid in seconds, exactly the amount asked.

Settings (`fin.payment.lightning`): `url` of the LNbits instance, the wallet's `invoiceKey` (it can
bill, not spend), `expiry` in minutes (60).

`start` asks LNbits for an invoice in the payment's currency — LNbits turns it into satoshis at
its rate — and sends the payer to the payment's `pay` page: the invoice as QR code and text. The
page looks again every few seconds (`watch`) and leads to `return` once paid. LNbits also calls
the payment's `notify` address. Not paid by the end of `expiry`: `expired`.

## Decisions that may change

- **LNbits as the only backend.** LNbits runs on LND, Core Lightning, Phoenix, Breez and others,
  so one API covers most setups. A node's own API (LND REST, phoenixd, Nostr Wallet Connect)
  would be a second backend behind the same provider, chosen by a setting.
- **The rate is LNbits'.** The satoshis are fixed when the invoice is made; `paid` is the amount
  asked, in the payment's currency.
- **No refunds**: paying back over Lightning needs an invoice from the payer.
