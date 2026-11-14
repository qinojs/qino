import { unixTime } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { grpsOf, listen, shopT } from "@qino/qino/cms.shop";

import type { Node } from "@qino/qino/cms";
import type { App, Row } from "@qino/qino";
import type { Line, Order, Product } from "@qino/qino/cms.shop";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

/** The discounts of an app, read once and again after a change — every price asks. */
const cached = new WeakMap<App, Promise<Row[]>>();
const discounts = (app: App): Promise<Row[]> =>
  cached.getOrInsertComputed(app, () => app.db.query`SELECT * FROM shop_discount ORDER BY factor`);

/** Whether a product lies below a node (0: everywhere). */
const below = async (app: App, productId: unknown, nodeId: number) =>
  !nodeId || await (await cms(app).node(Number(productId))).in(nodeId);

/** The best discount for a product at that moment: the lowest factor wins, discounts never add up.
 *  The amount is counted over all lines of the order below the discount's node, unless it is per line. */
export async function best(app: App, { product, quantity, order, usrId, time }: {
  product: Product;
  quantity: number;
  order?: Order;
  usrId?: number | null;
  time: number;
}): Promise<Row | undefined> {
  const grps = order ? await order.grps() : await grpsOf(app, usrId);
  const lines = order ? await order.lines() : [];
  // what lies above the product, once: a shop may have tens of thousands of discounts
  const path = new Set<number>();
  for (let n: Node | undefined = await cms(app).node(Number(product.$id)); n; n = await n.parent()) path.add(n.id);
  for (const d of await discounts(app)) { // lowest factor first
    const node = Number(d.node_id);
    if (node && !path.has(node)) continue;
    if (Number(d.grp_id) && !grps.includes(Number(d.grp_id))) continue;
    if ((Number(d.start) && time < Number(d.start)) || (Number(d.end) && time > Number(d.end))) continue;
    let amount = quantity;
    if (Number(d.min_quantity) > 0 && lines.length && !Number(d.per_line)) {
      amount = 0;
      for (const line of lines) if (await below(app, line.product_id, node)) amount += Number(line.quantity);
    }
    if (amount >= Number(d.min_quantity)) return d;
  }
}

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  const t = shopT(app);
  const on = listen(app, signal);
  for (const event of ["table:insert-after", "table:update-after", "table:delete-after"] as const) {
    app.db.on(event, ({ table }) => { if (table.name === "shop_discount") cached.delete(app); }, { signal });
  }

  // A reduced price lands on the currency's step (0.05 CHF).
  on("shop:price-discount", async (e) => {
    const d = await best(app, e);
    if (d) { const price = e.price * Number(d.factor); e.price = e.currency?.round(price) ?? price; }
  });

  on("shop:line-description", async (e: { line: Line; description: string }) => {
    const [order, product] = await Promise.all([e.line.order(), e.line.product()]);
    if (!order || !product) return;
    const d = await best(app, { product, quantity: e.line.quantity, order, time: unixTime() });
    if (!d) return;
    const off = Math.round((1 - Number(d.factor)) * 1000) / 10;
    e.description += `${e.description ? "\n" : ""}${await t`including`} ${off}% ${d.title || await t`discount`}`;
  });
}
