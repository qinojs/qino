import { add, balance } from "../mod.ts";

import type { Provider } from "@qino/qino/fin.payment";

const refOf = (id: unknown) => `fin.payment:${id}`;

/** Paying with credit: offered to a user who has enough, paid at once from the balance. */
export const paymentProvider: Provider = {
  name: "credit",
  label: "Credit",

  async methods(app, { amount, currency, usrId }) {
    if (!usrId || await balance(app, usrId, currency) < amount) return [];
    return [{ name: "", label: "Credit" }];
  },

  async start(app, payment, urls) {
    if (!payment.usr_id) throw new Error("fin.payment.credit: whose credit? The payment has no user");
    const amount = Number(payment.amount);
    await add(app, Number(payment.usr_id), {
      amount: -amount,
      currency: String(payment.currency),
      text: String(payment.description ?? ""),
      ref: refOf(payment.id),
    });
    return { status: "paid", paid: amount, redirect: urls.back };
  },

  // nothing outside to ask: what the balance gave is paid
  sync: () => Promise.resolve({}),

  async refund(app, payment, amount) {
    await add(app, Number(payment.usr_id), {
      amount,
      currency: String(payment.currency),
      text: String(payment.description ?? ""),
      ref: refOf(payment.id),
    });
    return {};
  },
};
