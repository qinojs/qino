import { getCtx } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { cart, ensureProduct } from "../shp3/mod.ts";

/** Add this page's product to the cart — never a product id from the request. */
export default async function (node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (!("add" in vars)) return false;
  if (await node.access() < 1) return false;
  const product = await ensureProduct(node.app.db, node.id);
  if (!product || Object.keys(await product.errors()).length) return false;

  const order = await cart(getCtx());
  if (!order) return false;
  const item = await order.itemAdd(product, Math.max(1, Math.trunc(Number(vars.quantity) || 1)), vars.config ?? null);
  await node.app.db.flush();
  return { item: item.$id, quantity: item.quantity, count: (await order.items()).length };
}
