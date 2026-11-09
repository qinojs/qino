import { shopT } from "@qino/qino/cms.shop";

import type { App } from "@qino/qino";
import type { Line, Order, Product, Solution, Variant } from "@qino/qino/cms.shop";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

// This module's column on the product and the variant row; the accessors come from the table.
declare module "@qino/qino/cms.shop" {
  interface Product { stock: number }
  interface Variant { stock: number }
}

/** Where the stock of a line is kept: its variant, else its product. */
const holder = async (line: Line): Promise<Product | Variant | undefined> => await line.variant() ?? line.product();

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  const t = shopT(app);
  // deno-lint-ignore no-explicit-any -- payloads are declared by cms.shop
  const on = (event: string, fn: (e: any) => unknown) => app.on(event, fn as never, { signal });

  // A product with variants is in stock as its variants are; one without, as it is itself.
  on("shop:product-check", async ({ product, variant, errors }: { product: Product; variant?: Variant; errors: Record<string, string> }) => {
    if (variant) {
      if (Number(variant.stock) < 1) errors["out of stock"] = await t`Not deliverable`;
    } else if (!(await product.variants()).length && Number(product.stock) < 1) {
      errors["out of stock"] = await t`This product is not in stock at the moment`;
    }
  });

  on("shop:line-check", async ({ line, errors, solutions }: { line: Line; errors: Record<string, string>; solutions: Record<string, Solution> }) => {
    const stock = Number((await holder(line))?.stock ?? 0);
    if (stock < 1 || stock >= line.quantity) return;
    errors["out of stock"] = `${await t`Units left in stock`}: ${stock}`;
    solutions["set quantity"] = { label: await t`Adjust quantity`, solve: () => line.setQuantity(stock) };
  });

  on("shop:ordered", async ({ order }: { order: Order }) => {
    for (const line of await order.lines()) {
      const row = await holder(line);
      if (row) row.stock = Number(row.stock) - Number(line.quantity);
    }
  });
}
