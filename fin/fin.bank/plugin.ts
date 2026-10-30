import type { App } from "@qino/qino";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };
export { api } from "./api.ts";

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  // a payment taken back frees the lines it was assigned: they are to be assigned again
  // deno-lint-ignore no-explicit-any -- module events carry their own payloads
  app.on("payment:change", async ({ payment }: any) => {
    if (payment?.status !== "canceled") return;
    await app.db.exec`UPDATE bank_tx SET payment_id = NULL WHERE payment_id = ${payment.id}`;
  }, { signal });
}
