import { listen } from "@qino/qino/cms.shop";

import type { App } from "@qino/qino";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  // A price set for a currency stands instead of the converted one.
  listen(app, signal)("shop:price-initial", async (e) => {
    if (!e.currency) return;
    const fixed = await app.db.one`SELECT price FROM shop_price
      WHERE product_id = ${e.product.$id} AND variant_id = ${Number(e.variant?.$id ?? 0)} AND currency = ${e.currency.$id}`;
    if (fixed != null) e.price = Number(fixed);
  });
}
