import type { App } from "@qino/qino";

/** Draw the next number for `format` (`{year}` and `{n}`, e.g. `R{year}-{n}`), inside the caller's
 *  transaction, so a number is never drawn twice and never skipped. */
export async function draw(app: App, format: string, date: string): Promise<string> {
  const key = format.replaceAll("{year}", date.slice(0, 4));
  if (!key.includes("{n}")) throw new Error("fin.invoice: the number format needs {n}");
  const counted = await app.db.exec`UPDATE invoice_counter SET n = n + 1 WHERE format = ${key}`;
  if (!counted.affectedRows) await app.db.table("invoice_counter").insert({ format: key, n: 1 });
  return key.replace("{n}", String(await app.db.one`SELECT n FROM invoice_counter WHERE format = ${key}`));
}
