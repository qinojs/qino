# fin.payment.bitcoin

**Bitcoin on-chain**, without anyone in between: each payment gets an address of its own, derived
from the wallet's public key. No private key on the server — it can show where to pay, not spend.

Settings (`fin.payment.bitcoin`): `xpub` — the extended public key of a wallet account (`zpub`,
or `xpub` of a native segwit account), `esplora` — an Esplora API with `/v1/prices`
(`https://mempool.space/api` by default, or your own mempool), `window` — minutes the price holds
(30), `confirmations` — until a payment counts (1).

`start` fixes the price in satoshis and shows the `pay` page: address, amount and a BIP21 QR code.
`sync` reads what arrived at the address: seen → `processing`, confirmed in full → `paid` (in the
payment's currency at the price asked), nothing by the end of the window → `expired`. The page
looks again every few seconds and leads to `return` once paid.

## Decisions that may change

- **The address index is the payment id** (`<account>/0/<id>`). Simple and never reused — but ids
  of payments with other providers leave gaps, and wallets look only 20 unused addresses ahead.
  Raise the gap limit in the wallet (Sparrow, Electrum: a setting), or give the account to this
  site alone and count addresses instead.
- **Native segwit only** (bc1q…), mainnet only.
- **Late money is not seen**: once `expired`, the address is no longer asked. A payment that
  arrives later shows in the wallet, not here.
- **Over- and underpayment** count as they are: `paid` is proportional to what arrived; less than
  asked stays `processing` and the page asks for the rest.
- **The price comes from the Esplora server** (`/v1/prices`, mempool's); other sources would be a
  setting.

## Not built (yet)

Stablecoins (USDC/USDT on Ethereum, Base, Tron, Solana), other chains, and hosted crypto
processors (Coinbase Commerce, NOWPayments, OpenNode) — each would be a provider like this one.
