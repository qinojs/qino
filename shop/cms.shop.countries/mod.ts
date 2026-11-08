import type { App } from "@qino/qino";

/** The countries a product may go to; empty: wherever the shop delivers. */
export const countriesOf = (app: App, productId: unknown): Promise<string[]> =>
  app.db.col<string>`SELECT country FROM shop_product_country WHERE product_id = ${productId} ORDER BY country`;
