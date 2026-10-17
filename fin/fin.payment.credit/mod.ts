import { unixTime } from "@qino/qino";
import { record, refOf } from "@qino/qino/fin.payment";

import type { App, Row } from "@qino/qino";

/** A user's credit in a currency, in minor units. */
export async function balance(app: App, usrId: number, currency: string): Promise<number> {
  return Number(await app.db.one`SELECT COALESCE(SUM(amount), 0) FROM payment_credit
    WHERE usr_id = ${usrId} AND currency = ${currency}`);
}

/** Add to a user's credit, or take from it with a negative amount; never below zero. */
export async function add(
  app: App,
  usrId: number,
  { amount, currency, text = "", ref }: { amount: number; currency: string; text?: string; ref?: string },
): Promise<number> {
  if (!Number.isSafeInteger(amount) || !amount) {
    throw new Error("fin.payment.credit: amounts are integers in minor units");
  }
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("fin.payment.credit: currency is ISO 4217");
  return await app.db.transaction(async () => {
    if (amount < 0 && await balance(app, usrId, currency) + amount < 0) {
      throw new Error("fin.payment.credit: not enough credit");
    }
    return Number(await app.db.table("payment_credit").insert({
      usr_id: usrId,
      currency,
      amount,
      text: text.slice(0, 191),
      ref: ref ?? null,
      created: unixTime(),
    }));
  });
}

/** Pay out onto a user's credit: an outgoing payment (`credit`) for `ref`, and the credit it adds. */
export async function payOut(
  app: App,
  usrId: number,
  { amount, currency, ref, text = "" }: { amount: number; currency: string; ref?: string; text?: string },
): Promise<number> {
  return await app.db.transaction(async () => {
    const payment = await record(app, { direction: "out", provider: "credit", amount, currency, ref, usrId });
    await add(app, usrId, { amount, currency, text, ref: refOf(payment) });
    return payment;
  });
}

/** What moved on a user's credit, newest first. */
export const moves = (app: App, usrId: number): Promise<Row[]> =>
  app.db.query`SELECT * FROM payment_credit WHERE usr_id = ${usrId} ORDER BY id DESC LIMIT 100`;
