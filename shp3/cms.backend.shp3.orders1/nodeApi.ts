import type { Node } from "@qino/qino/cms";
import type { Order } from "@qino/qino/shp3";

export default async function (node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (await node.access() < 2) return false;
  const orders = node.app.db.table("shp3_order");

  if ("pay" in vars) {
    const order = await orders.get<Order>(vars.pay);
    if (!order?.time_ordered) return false;
    // What is still open, not the total — a partial payment may already have arrived.
    await order.pay(Number(order.cost) - Number(order.paid));
    await node.app.db.flush();
    return { paid: order.paid };
  }

  if ("place" in vars) {
    const order = await orders.get<Order>(vars.place);
    if (!order || order.time_ordered) return false;
    const result = await order.tryPlace();
    return result.success ? { id: order.$id } : { error: Object.values(result.errors).join(", ") };
  }

  if ("delete" in vars) {
    if (await node.access() < 3) return false;
    return await orders.delete(vars.delete) ? 1 : false;
  }

  return false;
}
