# fin.bank.camt

Reads ISO 20022 **camt.053** (account statement) and **camt.054** (debit/credit notification) — the
XML banks across Europe, and all Swiss ones, export — into [fin.bank](../fin.bank/).

```ts
import { fs } from "@qino/qino";
import { ingest, ingestZip, parse } from "@qino/qino/fin.bank.camt";

await ingest(app, await fs.text("statement.xml")); // { added, matched }
await ingestZip(app, bytes); // a ZIP of such files, as banks deliver them; all read before any is stored
parse(xml); // the statements, without storing them
```

A batch entry (a collective booking of many QR payments) is split into its transactions, each
with its own amount and reference — that is where the references to match are. An entry without
details is one line. The reference is the structured creditor reference (QR, `RF…`), else the
end-to-end id; the other side is the debtor for money in and the creditor for money out. Amounts
become minor units in the currency's own decimals; more decimals than it has are refused. Only
booked entries are read, a pending one is not money yet. A reversal is an ordinary line, signed
by its debit or credit.

Elements are read by local name, so prefixed documents work, and versions .001.04 to .001.08 read
alike for what is used here.
