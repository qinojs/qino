import { unixTime } from "@qino/qino";
import { record, sync } from "@qino/qino/fin.payment";

import type { App } from "@qino/qino";

/** One line of a statement, whatever format it came in. `id` is the bank's own id for it; amounts
 *  are signed (in positive, out negative) and in minor units; `date` is `YYYY-MM-DD`. */
export type Tx = {
  id: string;
  date: string;
  amount: number;
  currency?: string;
  reference?: string;
  partyName?: string;
  partyAccount?: string;
  text?: string;
};

/** What an importer hands over: the account and its lines. */
export type Statement = { iban: string; currency: string; name?: string; transactions: Tx[] };

/** References compare without spaces and case: `RF18 5390 0754 7034` is `RF18539007547034`. */
const normalize = (value: string) => value.replace(/\s+/g, "").toUpperCase();

/**
 * Store a statement. Lines seen before are skipped, so overlapping statements are harmless. A line
 * whose reference is a payment's `external_id` (a QR bill, an end-to-end id) is matched to it, and
 * that payment synced — its provider reads what arrived with `paid()`.
 */
export async function ingest(app: App, statement: Statement): Promise<{ added: number; matched: number }> {
  const account = await accountId(app, statement);
  const table = app.db.table("bank_tx");
  const synced = new Set<number>();
  let added = 0;
  for (const tx of statement.transactions) {
    if (!Number.isSafeInteger(tx.amount)) throw new Error("fin.bank: amounts are integers in minor units");
    const externalId = `${account}:${tx.id}`;
    if (await app.db.one`SELECT 1 FROM bank_tx WHERE external_id = ${externalId}`) continue;
    const reference = tx.reference ? normalize(tx.reference) : null;
    const payment = reference ? await match(app, reference, tx.amount) : undefined;
    await table.insert({
      account_id: account,
      date: tx.date,
      amount: tx.amount,
      currency: tx.currency ?? statement.currency,
      reference,
      party_name: tx.partyName?.slice(0, 191) ?? null,
      party_account: tx.partyAccount ? normalize(tx.partyAccount).slice(0, 64) : null,
      text: tx.text ?? null,
      external_id: externalId,
      payment_id: payment ?? null,
      created: unixTime(),
    });
    added++;
    if (payment) synced.add(payment);
  }
  for (const id of synced) await sync(app, id);
  return { added, matched: synced.size };
}

/**
 * Settle a line nobody claimed: it becomes a recorded payment for `ref` (an invoice, an order), in
 * the direction of its sign.
 */
export async function assign(app: App, txId: number, ref: string): Promise<number> {
  const tx = await app.db.row`SELECT * FROM bank_tx WHERE id = ${txId}`;
  if (!tx) throw new Error(`fin.bank: no line ${txId}`);
  if (tx.payment_id) throw new Error("fin.bank: the line is already assigned");
  const amount = Number(tx.amount);
  return await app.db.transaction(async () => {
    const payment = await record(app, {
      direction: amount > 0 ? "in" : "out",
      provider: "bank",
      amount: Math.abs(amount),
      currency: String(tx.currency),
      ref,
      title: String(tx.party_name ?? "") || undefined,
    });
    await app.db.exec`UPDATE bank_tx SET payment_id = ${payment} WHERE id = ${txId}`;
    return payment;
  });
}

/** What the bank says arrived (or left) for a payment, in minor units. */
export async function paid(app: App, paymentId: number): Promise<number> {
  const sum = await app.db.one`SELECT COALESCE(SUM(amount), 0) FROM bank_tx WHERE payment_id = ${paymentId}`;
  return Math.abs(Number(sum));
}

/** The payment a reference belongs to: the newest not canceled one, in the line's direction. */
async function match(app: App, reference: string, amount: number) {
  const id = await app.db.one`
    SELECT id FROM payment
    WHERE external_id = ${reference} AND direction = ${amount > 0 ? "in" : "out"} AND status <> 'canceled'
    ORDER BY id DESC LIMIT 1`;
  return id == null ? undefined : Number(id);
}

/** The account of the statement, created when first seen. */
async function accountId(app: App, statement: Statement) {
  const iban = normalize(statement.iban);
  if (!iban) throw new Error("fin.bank: a statement needs its account");
  const known = await app.db.one`SELECT id FROM bank_account WHERE iban = ${iban}`;
  if (known != null) return Number(known);
  return Number(await app.db.table("bank_account").insert({
    iban,
    currency: statement.currency,
    name: statement.name ?? iban,
    created: unixTime(),
  }));
}
