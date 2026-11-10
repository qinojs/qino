# fin.bank.ebics

Read-only EBICS 3.0 (H005) connection: downloads camt.054 ZIPs and imports them through
[fin.bank.camt](../fin.bank.camt/). It submits no payment orders. No bank name is built in; each
connection names its own BTF.

A delivery is stored durably (fsync, rename) before the bank gets `ReceiptCode 0`; if storing
fails, it gets `ReceiptCode 1` and delivers again. The hourly `cron` job imports what is stored
first, so a crash after the receipt loses nothing. Files live under the module's `data/`:
`keys.json` (the encrypted keyring), `incoming/`, `incoming/archive/` and `incoming/failed/` — a
ZIP that cannot be read is moved there, the job reports it and carries on with the others.

## Settings

| Setting | |
| --- | --- |
| `url`, `hostId`, `partnerId`, `userId` | From the bank's EBICS contract; `url` must be HTTPS |
| `passphraseEnv` | Name of the environment variable with the keyring passphrase, so it stays out of database and data backups |
| `bankX002`, `bankE002` | The bank's key hashes (64 hex digits) from its documentation, never from HPB |
| `btfService`, `btfScope`, `btfVersion` | The camt.054 BTF, e.g. `REP`, `CH`, `08` |
| `btfOption` | Optional service option |

The bank must offer detailed camt.054 for incoming QR payments in the contract.

## Enrolment

Once, in order, on the bank page of the backend (cms.backend.fin.bank, which also edits the
settings and can download at once), or with `enrol(app, step)`:

1. `keys` creates the three keys and returns their fingerprints for the bank's initialisation
   letter. It refuses if a keyring exists: never replace keys already submitted.
2. `ini`, then `hia` send them.
3. Sign and submit the letter; the bank activates the user.
4. `hpb` fetches the bank's keys and stores them only if they match `bankX002` and `bankE002`.
   Every download checks them again.

## Client

The H005 client is [@kage0x3b/ebics-client](https://github.com/Kage0x3B/node-ebics-client), a
fork of node-ebics-client (H004 only), pinned to an exact version. It has no hook between
download and receipt, so `downloadSafely` holds back its internal `sendReceipt`; a test fails if
an upgrade changes that flow. Test with the bank and review the transport before productive use.
