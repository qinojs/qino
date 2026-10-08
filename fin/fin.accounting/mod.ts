import { getCtx, sql, unixTime } from "@qino/qino";
import { addDays, today } from "@qino/qino/fin";

import type { App, DbFile, Row } from "@qino/qino";

/** The five kinds of account: the first three make the balance sheet, the last two the result. */
export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

/** A line as booked: the account's number, debit positive and credit negative, in minor units. */
export type Line = { account: string; amount: number; taxCode?: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function fail(message: string): never {
  throw new Error(`fin.accounting: ${message}`);
}

/** Create or rename an account. Charts come from country modules or are kept by hand. */
export async function account(app: App, number: string, values: { name: string; type: AccountType }): Promise<number> {
  const known = await app.db.one`SELECT id FROM accounting_account WHERE number = ${number}`;
  if (known != null) {
    await app.db.table("accounting_account").update(Number(known), values);
    return Number(known);
  }
  return Number(await app.db.table("accounting_account").insert({ number, ...values }));
}

/**
 * Book an entry. Its lines add up to zero — what is debited somewhere is credited elsewhere — and
 * name accounts by number. A date in a closed period is refused. Entries are never changed; a
 * mistake is taken back with `reverse()`.
 */
export async function book(app: App, entry: {
  date: string;
  text: string;
  lines: Line[];
  currency?: string;
  ref?: string;
  files?: DbFile[];
}): Promise<number> {
  const s = app.settings["fin.accounting"];
  const currency = entry.currency ?? String(await s.currency ?? "");
  if (!/^[A-Z]{3}$/.test(currency)) fail("the book needs its currency (fin.accounting.currency)");
  if (!DATE.test(entry.date)) fail("dates are YYYY-MM-DD");
  const closed = String(await s.closedUntil ?? "");
  if (closed && entry.date <= closed) fail(`the books are closed until ${closed}`);
  const lines = entry.lines.filter((line) => line.amount !== 0);
  if (lines.length < 2) fail("an entry needs two lines at least");
  if (!lines.every((line) => Number.isSafeInteger(line.amount))) fail("amounts are integers in minor units");
  if (lines.reduce((sum, line) => sum + line.amount, 0) !== 0) fail("the lines do not add up to zero");
  const numbers = [...new Set(lines.map((line) => line.account))];
  const ids = new Map((await app.db.query`SELECT id, number FROM accounting_account WHERE ${sql.in("number", numbers)}`)
    .map((row) => [String(row.number), Number(row.id)]));
  const missing = numbers.filter((n) => !ids.has(n));
  if (missing.length) fail(`no account ${missing.join(", ")}`);
  return await app.db.transaction(async () => {
    const id = Number(await app.db.table("accounting_entry").insert({
      date: entry.date,
      text: entry.text.slice(0, 191),
      currency,
      ref: entry.ref ?? null,
      usr_id: userId(),
      created: unixTime(),
    }));
    for (const line of lines) {
      await app.db.table("accounting_entry_line").insert({
        entry_id: id,
        account_id: ids.get(line.account),
        amount: line.amount,
        tax_code: line.taxCode ?? null,
      });
    }
    for (const file of entry.files ?? []) {
      await app.db.table("accounting_entry_file").insert({ entry_id: id, file_id: file.id });
    }
    return id;
  });
}

/** Take an entry back: the same lines the other way, on `date` (today by default). */
export async function reverse(
  app: App,
  id: number,
  { date, text }: { date?: string; text?: string } = {},
): Promise<number> {
  const entry = await app.db.row`SELECT * FROM accounting_entry WHERE id = ${id}`;
  if (!entry) fail(`no entry ${id}`);
  if (await app.db.one`SELECT id FROM accounting_entry WHERE reverses = ${id}`) fail("already reversed");
  const lines = await app.db.query`
    SELECT a.number, l.amount, l.tax_code FROM accounting_entry_line l
    JOIN accounting_account a ON a.id = l.account_id WHERE l.entry_id = ${id}`;
  // one transaction: an entry that takes another back is always marked so
  return await app.db.transaction(async () => {
    const back = await book(app, {
      date: date ?? today(),
      text: text ?? `Reversal: ${entry.text}`,
      currency: String(entry.currency),
      ref: entry.ref == null ? undefined : String(entry.ref),
      lines: lines.map((l) => ({
        account: String(l.number),
        amount: -Number(l.amount),
        taxCode: l.tax_code || undefined,
      })),
    });
    await app.db.exec`UPDATE accounting_entry SET reverses = ${id} WHERE id = ${back}`;
    return back;
  });
}

/** Add receipts to an entry — a receipt may come after the booking. */
export async function attach(app: App, id: number, files: DbFile[]): Promise<void> {
  for (const file of files) await app.db.table("accounting_entry_file").ensure({ entry_id: id, file_id: file.id });
}

/**
 * Every account with what is booked on it: up to `to` for the balance sheet, from `from` to `to`
 * for income and expense — the result of a period. Debit positive, credit negative.
 */
export async function balances(
  app: App,
  { from, to, closings = true }: { from?: string; to?: string; closings?: boolean } = {},
): Promise<Row[]> {
  const until = to ? sql`AND e.date <= ${to}` : sql``;
  // without the closing entries, a closed year still shows its result
  const open = closings ? sql`` : sql`AND (e.ref IS NULL OR e.ref NOT LIKE ${`${CLOSING}%`})`;
  const since = from ? sql`AND (a.type IN ('asset', 'liability', 'equity') OR e.date >= ${from})` : sql``;
  return await app.db.query`
    SELECT a.id, a.number, a.name, a.type,
      COALESCE(SUM(CASE WHEN e.id IS NULL THEN 0 ELSE l.amount END), 0) AS balance
    FROM accounting_account a
    LEFT JOIN accounting_entry_line l ON l.account_id = a.id
    LEFT JOIN accounting_entry e ON e.id = l.entry_id ${until} ${since} ${open}
    GROUP BY a.id, a.number, a.name, a.type
    ORDER BY a.number`;
}

/** The ref of the entries that close a year: `fin.accounting:close:2026-12-31`. */
const CLOSING = "fin.accounting:close:";

/**
 * Close the business year that ends on `until` — any day, not only the 31st of December: its
 * income and expense since the last closing go to the result account (`accounts.result`, equity)
 * in one entry on that day, and the books are closed up to it. A year with nothing booked closes
 * without an entry.
 */
export async function close(app: App, until: string): Promise<number | undefined> {
  if (!DATE.test(until)) fail("dates are YYYY-MM-DD");
  const s = app.settings["fin.accounting"];
  const closed = String(await s.closedUntil ?? "");
  if (closed && until <= closed) fail(`closed until ${closed} already`);
  const result = String(await s.accounts.result ?? "");
  if (!result) fail("where does the result go? Set fin.accounting.accounts.result");
  const from = closed ? addDays(closed, 1) : undefined;
  const flows = (await balances(app, { from, to: until }))
    .filter((a) => (a.type === "income" || a.type === "expense") && Number(a.balance));
  // each account back to zero, the difference — profit as credit, loss as debit — onto equity
  const lines = flows.map((a) => ({ account: String(a.number), amount: -Number(a.balance) }));
  lines.push({ account: result, amount: flows.reduce((sum, a) => sum + Number(a.balance), 0) });
  const id = lines.length > 1
    ? await book(app, { date: until, text: `Closing ${until}`, ref: `${CLOSING}${until}`, lines })
    : undefined;
  await s.closedUntil(until);
  return id;
}

/** Open the last closed year again: its closing entry is taken back on its own day. */
export async function reopen(app: App): Promise<void> {
  const s = app.settings["fin.accounting"];
  const closed = String(await s.closedUntil ?? "");
  if (!closed) fail("nothing is closed");
  const entry = await app.db.one`SELECT id FROM accounting_entry e WHERE ref = ${`${CLOSING}${closed}`}
    AND reverses IS NULL AND NOT EXISTS (SELECT 1 FROM accounting_entry r WHERE r.reverses = e.id)`;
  // the closing before is where the books stay closed; none, and they are open
  const before = await app.db.one`SELECT MAX(date) FROM accounting_entry e
    WHERE ref LIKE ${`${CLOSING}%`} AND date < ${closed} AND reverses IS NULL
      AND NOT EXISTS (SELECT 1 FROM accounting_entry r WHERE r.reverses = e.id)`;
  await s.closedUntil(before ? String(before).slice(0, 10) : "");
  if (entry != null) await reverse(app, Number(entry), { date: closed, text: `Reopened ${closed}` });
}

/** Who books, inside a request; nobody for an automatic entry. */
function userId() {
  try {
    return getCtx().userId || null;
  } catch {
    return null;
  }
}
