import { getCtx, sql, unixTime } from "@qino/qino";

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
  const known = await app.db.one`SELECT id FROM account WHERE number = ${number}`;
  if (known != null) {
    await app.db.table("account").update(Number(known), values);
    return Number(known);
  }
  return Number(await app.db.table("account").insert({ number, ...values }));
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
  const ids = new Map((await app.db.query`SELECT id, number FROM account WHERE ${sql.in("number", numbers)}`)
    .map((row) => [String(row.number), Number(row.id)]));
  const missing = numbers.filter((n) => !ids.has(n));
  if (missing.length) fail(`no account ${missing.join(", ")}`);
  return await app.db.transaction(async () => {
    const id = Number(await app.db.table("entry").insert({
      date: entry.date,
      text: entry.text.slice(0, 191),
      currency,
      ref: entry.ref ?? null,
      usr_id: userId(),
      created: unixTime(),
    }));
    for (const line of lines) {
      await app.db.table("entry_line").insert({
        entry_id: id,
        account_id: ids.get(line.account),
        amount: line.amount,
        tax_code: line.taxCode ?? null,
      });
    }
    for (const file of entry.files ?? []) await app.db.table("entry_file").insert({ entry_id: id, file_id: file.id });
    return id;
  });
}

/** Take an entry back: the same lines the other way, on `date` (today by default). */
export async function reverse(
  app: App,
  id: number,
  { date, text }: { date?: string; text?: string } = {},
): Promise<number> {
  const entry = await app.db.row`SELECT * FROM entry WHERE id = ${id}`;
  if (!entry) fail(`no entry ${id}`);
  if (await app.db.one`SELECT id FROM entry WHERE reverses = ${id}`) fail("already reversed");
  const lines = await app.db.query`
    SELECT a.number, l.amount, l.tax_code FROM entry_line l
    JOIN account a ON a.id = l.account_id WHERE l.entry_id = ${id}`;
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
  await app.db.exec`UPDATE entry SET reverses = ${id} WHERE id = ${back}`;
  return back;
}

/** Add receipts to an entry — a receipt may come after the booking. */
export async function attach(app: App, id: number, files: DbFile[]): Promise<void> {
  for (const file of files) await app.db.table("entry_file").ensure({ entry_id: id, file_id: file.id });
}

/**
 * Every account with what is booked on it: up to `to` for the balance sheet, from `from` to `to`
 * for income and expense — the result of a period. Debit positive, credit negative.
 */
export async function balances(app: App, { from, to }: { from?: string; to?: string } = {}): Promise<Row[]> {
  const until = to ? sql`AND e.date <= ${to}` : sql``;
  const since = from ? sql`AND (a.type IN ('asset', 'liability', 'equity') OR e.date >= ${from})` : sql``;
  return await app.db.query`
    SELECT a.id, a.number, a.name, a.type,
      COALESCE(SUM(CASE WHEN e.id IS NULL THEN 0 ELSE l.amount END), 0) AS balance
    FROM account a
    LEFT JOIN entry_line l ON l.account_id = a.id
    LEFT JOIN entry e ON e.id = l.entry_id ${until} ${since}
    GROUP BY a.id, a.number, a.name, a.type
    ORDER BY a.number`;
}

const today = () => new Date().toLocaleDateString("sv-SE");

/** Who books, inside a request; nobody for an automatic entry. */
function userId(): number | null {
  try {
    return getCtx().userId || null;
  } catch {
    return null;
  }
}
