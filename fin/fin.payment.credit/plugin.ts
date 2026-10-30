import { refOf } from "@qino/qino/fin.payment";

import { add } from "./mod.ts";

import type { App } from "@qino/qino";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };
export { api } from "./api.ts";
export { paymentProvider } from "./lib/provider.ts";

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  // a payment onto credit taken back takes its credit back — refused where it is spent already
  // deno-lint-ignore no-explicit-any -- module events carry their own payloads
  app.on("payment:change", async ({ payment }: any) => {
    if (payment?.status !== "canceled" || !payment.usr_id) return;
    const ref = refOf(Number(payment.id));
    const given = Number(await app.db.one`SELECT COALESCE(SUM(amount), 0) FROM payment_credit WHERE ref = ${ref}`);
    if (given <= 0) return;
    const text = String(payment.description ?? "");
    await add(app, Number(payment.usr_id), { amount: -given, currency: String(payment.currency), text, ref });
  }, { signal });
}
