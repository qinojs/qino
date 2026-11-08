import { cms } from "@qino/qino/cms";
import { shopT } from "@qino/qino/cms.shop";

import type { App, Row } from "@qino/qino";
import type { Line, Order, Product } from "@qino/qino/cms.shop";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

/** The discounts of an app, read once and again after a change — every price asks. */
const cached = new WeakMap<App, Promise<Row[]>>();
const discounts = (app: App): Promise<Row[]> => {
  let rows = cached.get(app);
  if (!rows) cached.set(app, rows = app.db.query`SELECT * FROM shop_discount ORDER BY factor`);
  return rows;
};

/** Whether a product lies below a node (0: everywhere). */
const below = async (app: App, productId: unknown, nodeId: number) =>
  !nodeId || await (await cms(app).node(Number(productId))).in(nodeId);

/** The best discount for a product at that moment: the lowest factor wins, discounts never add up.
 *  The amount is counted over all lines of the order below the discount's node. */
export async function best(app: App, { product, quantity, order, usrId, time }: {
  product: Product;
  quantity: number;
  order?: Order;
  usrId?: number | null;
  time: number;
}): Promise<Row | undefined> {
  const grps = order ? await order.grps() : usrId ? (await app.db.col<number>`SELECT grp_id FROM usr_grp WHERE usr_id = ${usrId}`).map(Number) : [];
  const lines = order ? await order.lines() : [];
  for (const d of await discounts(app)) { // lowest factor first
    const node = Number(d.node_id);
    if (Number(d.grp_id) && !grps.includes(Number(d.grp_id))) continue;
    if ((Number(d.start) && time < Number(d.start)) || (Number(d.end) && time > Number(d.end))) continue;
    if (!await below(app, product.$id, node)) continue;
    let amount = quantity;
    if (Number(d.min_quantity) > 0 && lines.length) {
      amount = 0;
      for (const line of lines) if (await below(app, line.product_id, node)) amount += Number(line.quantity);
    }
    if (amount >= Number(d.min_quantity)) return d;
  }
}

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  const t = shopT(app);
  // deno-lint-ignore no-explicit-any -- payloads are declared by cms.shop
  const on = (event: string, fn: (e: any) => unknown) => app.on(event, fn as never, { signal });
  for (const event of ["table:insert-after", "table:update-after", "table:delete-after"] as const) {
    app.db.on(event, ({ table }) => { if (table.name === "shop_discount") cached.delete(app); }, { signal });
  }

  // A reduced price lands on the currency's step (0.05 CHF).
  on("shop:price-discount", async (e) => {
    const d = await best(app, e);
    if (d) e.price = e.currency ? e.currency.round(e.price * Number(d.factor)) : e.price * Number(d.factor);
  });

  on("shop:line-description", async (e: { line: Line; description: string }) => {
    const [order, product] = await Promise.all([e.line.order(), e.line.product()]);
    if (!order || !product) return;
    const d = await best(app, { product, quantity: e.line.quantity, order, time: Date.now() / 1000 });
    if (!d) return;
    const off = Math.round((1 - Number(d.factor)) * 1000) / 10;
    e.description += `${e.description ? "\n" : ""}${await t`including`} ${off}% ${d.title || await t`discount`}`;
  });
}
