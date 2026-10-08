// The export lives in this page for now; once something else needs it — an API, a schedule — it
// moves into a module of its own (fin.accounting.export).
import { fs } from "@qino/qino";
import { balances } from "@qino/qino/fin.accounting";
import { currency as currencies } from "@qino/qino/locale.currency";
import { zipSync } from "fflate";

import type { App } from "@qino/qino";

/** A CSV field: quoted where it has to be. Semicolons, as spreadsheets in most of Europe expect. */
const field = (value: unknown) => {
  const text = String(value ?? "");
  return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
/** Rows as CSV, with a byte order mark so a spreadsheet reads UTF-8 as such. */
const csv = (rows: unknown[][]) => "﻿" + rows.map((row) => row.map(field).join(";")).join("\r\n") + "\r\n";

/** A file name that is safe in an archive. */
const safe = (name: string) => name.replace(/[^\w.-]+/g, "_");

/**
 * The books of a period for the fiduciary, as a ZIP: `journal.csv` — one row per entry line,
 * debit and credit apart —, `balances.csv` — every account with its balance —, and the receipts
 * under `receipts/`, named by their entry. Any bookkeeping software or spreadsheet reads it.
 */
export async function exportBooks(app: App, { from, to }: { from: string; to: string }): Promise<Uint8Array> {
  const book = String(await app.settings["fin.accounting"].currency ?? "");
  const decimals = currencies.decimals(book || "CHF");
  const amount = (minor: number) => minor ? (minor / 10 ** decimals).toFixed(decimals) : "";
  const lines = await app.db.query`
    SELECT e.id, e.date, e.text, e.currency, e.ref, e.reverses, a.number, a.name, l.amount, l.tax_code
    FROM accounting_entry e JOIN accounting_entry_line l ON l.entry_id = e.id
    JOIN accounting_account a ON a.id = l.account_id
    WHERE e.date >= ${from} AND e.date <= ${to} ORDER BY e.date, e.id, l.id`;
  const files: Record<string, Uint8Array> = {};
  const receipts = new Map<number, string[]>();
  for (const row of await app.db.query`SELECT f.entry_id, f.file_id FROM accounting_entry_file f
    JOIN accounting_entry e ON e.id = f.entry_id WHERE e.date >= ${from} AND e.date <= ${to}`) {
    const file = await app.dbFiles.file(Number(row.file_id)).catch(() => undefined);
    if (!file || !await file.exists()) continue;
    const name = `receipts/${row.entry_id}-${safe(file.name || `file-${file.id}`)}`;
    files[name] = await fs.bytes(file.path);
    receipts.set(Number(row.entry_id), [...receipts.get(Number(row.entry_id)) ?? [], name]);
  }
  files["journal.csv"] = new TextEncoder().encode(csv([
    ["Date", "Entry", "Text", "Account", "Account name", "Debit", "Credit", "Tax code", "Currency", "Reference",
      "Reverses", "Receipts"],
    ...lines.map((l) => [
      l.date, l.id, l.text, l.number, l.name,
      amount(Math.max(Number(l.amount), 0)), amount(Math.max(-Number(l.amount), 0)),
      l.tax_code, l.currency, l.ref, l.reverses, (receipts.get(Number(l.id)) ?? []).join(" "),
    ]),
  ]));
  files["balances.csv"] = new TextEncoder().encode(csv([
    ["Account", "Name", "Type", "Balance"],
    ...(await balances(app, { from, to })).map((a) => [a.number, a.name, a.type, amount(Number(a.balance))]),
  ]));
  return zipSync(files);
}
