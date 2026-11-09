import { listen, shopT } from "@qino/qino/cms.shop";

import type { App } from "@qino/qino";
import type { Line, Order, Product, Solution, Variant } from "@qino/qino/cms.shop";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

// This module's column on the product and the variant row; the accessors come from the table.
declare module "@qino/qino/cms.shop" {
  interface Product { stock: number | null }
  interface Variant { stock: number | null }
}

/** Whether a row keeps stock: none is not kept at all, it is always there. */
const kept = (row?: Product | Variant): row is Product | Variant => row?.stock != null;

/** Where the stock of a line is kept: its variant, else its product. */
const holder = async (line: Line): Promise<Product | Variant | undefined> => await line.variant() ?? line.product();

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  const t = shopT(app);
  const on = listen(app, signal);

  // A product with variants is in stock as its variants are; one without, as it is itself.
  on("shop:product-check", async ({ product, variant, errors }: { product: Product; variant?: Variant; errors: Record<string, string> }) => {
    if (variant) {
      if (kept(variant) && Number(variant.stock) < 1) errors["out of stock"] = await t`Not deliverable`;
    } else if (kept(product) && !(await product.variants()).length && Number(product.stock) < 1) {
      errors["out of stock"] = await t`This product is not in stock at the moment`;
    }
  });

  on("shop:line-check", async ({ line, errors, solutions }: { line: Line; errors: Record<string, string>; solutions: Record<string, Solution> }) => {
    const row = await holder(line);
    if (!kept(row)) return;
    const stock = Number(row.stock);
    if (stock < 1 || stock >= line.quantity) return;
    errors["out of stock"] = `${await t`Units left in stock`}: ${stock}`;
    solutions["set quantity"] = { label: await t`Adjust quantity`, solve: () => line.setQuantity(stock) };
  });

  on("shop:ordered", async ({ order }: { order: Order }) => {
    for (const line of await order.lines()) {
      const row = await holder(line);
      if (kept(row)) row.stock = Number(row.stock) - Number(line.quantity);
    }
  });

  // a canceled order puts its amounts back
  on("shop:status", async ({ order }: { order: Order }) => {
    if (order.status !== "canceled") return;
    for (const line of await order.lines()) {
      const row = await holder(line);
      if (kept(row)) row.stock = Number(row.stock) + Number(line.quantity);
    }
  });
}
