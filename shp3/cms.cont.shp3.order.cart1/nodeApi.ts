import { getCtx } from "../../module/core/mod.ts";
import type { Node } from "../../module/cms/mod.ts";
import { cart } from "../shp3/mod.ts";

/** Cart edits. The order is always the visitor's own — never an id from the request. */
export default async function (node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const order = await cart(getCtx(), false);
  if (!order || order.time_ordered) return false;

  if ("quantity" in vars) {
    const item = await order.item(vars.quantity);
    if (!item) return false;
    const quantity = Math.max(0, Math.trunc(Number(vars.value)));
    if (!quantity) await order.itemRemove(item);
    else await item.setQuantity(quantity);
  } else if ("resolve" in vars) {
    if (!await order.item(vars.resolve)) return false;
    await order.resolveItem(vars.resolve);
  } else if ("remove" in vars) {
    if (!await order.item(vars.remove)) return false;
    await order.itemRemove(vars.remove);
  } else {
    return false;
  }
  await node.app.db.flush();
  const { gross } = await order.costs();
  return { gross: (await order.currencyRow())?.format(gross) ?? gross };
}
