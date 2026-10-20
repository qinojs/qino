// The accounting of a PHP installation (cms.backend.accounting1*) as one JSON file for import.ts.
//
//   deno run -A export.ts mysql://user:pass@localhost/db accounting.json
//
// Dates stay strings as stored: a DATE must not become a Date in the local time zone.
import mysql from "mysql2/promise";

const TABLES = [
  "usr",
  "accounting1_invoice",
  "accounting1_invoice_item",
  "accounting1_invoice_payment",
  "accounting1_usr_credit_history",
  "accounting1_abo1",
  "accounting1_abo1_year",
  "managed_domains",
];

const [url, out = "accounting.json"] = Deno.args;
if (!url) throw new Error("usage: export.ts mysql://user:pass@host/db [out.json]");
const db = await mysql.createConnection({ uri: url, dateStrings: true, decimalNumbers: true });
const data: Record<string, unknown[]> = {};
for (const table of TABLES) data[table] = (await db.query(`SELECT * FROM \`${table}\``))[0] as unknown[];
await db.end();
// passwords stay behind
for (const row of data.usr as Record<string, unknown>[]) delete row.pw;
await Deno.writeTextFile(out, JSON.stringify(data));
console.log(Object.entries(data).map(([t, rows]) => `${t}: ${rows.length}`).join("\n"));
