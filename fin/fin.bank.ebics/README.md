# fin.bank.ebics

Read-only EBICS 3.0/H005 connection. Every connection supplies its own BTF; no bank names are
built into this module. It downloads camt.054 ZIPs and stores each ZIP durably before sending
EBICS `ReceiptCode 0`. `cron` imports confirmed ZIPs through `fin.bank.camt`. A crash after
receipt leaves the file in the spool; the next run imports it. The archive retains imported ZIPs.

The module setting `fin.bank.ebics.config` is an absolute path to a private JSON file outside
the web root. The keyring is encrypted and its passphrase comes from an environment variable.
The bank's X002 and E002 fingerprints must come from a separate trusted channel, not from HPB.

```json
{
  "url": "https://bank.example/ebics",
  "hostId": "BANKHOST",
  "partnerId": "00123456",
  "userId": "USER1",
  "keyring": "/private/qino/ebics/keys.json",
  "spool": "/private/qino/ebics/incoming",
  "passphraseEnv": "QINO_EBICS_PASSPHRASE",
  "bankHashes": {
    "authentication": "64 hex digits from the bank's documentation",
    "encryption": "64 hex digits from the bank's documentation"
  },
  "btf": {
    "serviceName": "REP",
    "scope": "CH",
    "messageVersion": "08"
  }
}
```

`btf.serviceOption` is optional. Set it when the connection uses one. The chosen BTF must be
available in the bank's EBICS contract, and the bank must offer detailed camt.054 for incoming
QR payments. The module does not submit payment orders.

Run the one-time enrolment steps in order. `keys` creates three certificate-backed keys and
prints their fingerprints for the bank's initialisation letter. Never regenerate a keyring
already submitted to the bank. Submit the signed letter using the bank's onboarding process,
have the bank activate the user, then verify HPB before enabling the scheduled download.

```sh
deno run --allow-read --allow-write --allow-env --allow-net fin/fin.bank.ebics/onboard.ts keys /private/qino/ebics/connection.json
deno run --allow-read --allow-write --allow-env --allow-net fin/fin.bank.ebics/onboard.ts ini /private/qino/ebics/connection.json
deno run --allow-read --allow-write --allow-env --allow-net fin/fin.bank.ebics/onboard.ts hia /private/qino/ebics/connection.json
deno run --allow-read --allow-write --allow-env --allow-net fin/fin.bank.ebics/onboard.ts hpb /private/qino/ebics/connection.json
```

This implementation uses a pinned TypeScript H005 client. Its internal receipt method is
intercepted so Qino can stage data before acknowledgement. The module refuses to run if that
method's flow changes. The transport still requires a bank test and security review before
productive use.
