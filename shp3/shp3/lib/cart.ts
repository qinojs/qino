import { type App, type Ctx, unixTime } from "../../../module/core/mod.ts";
import type { Order } from "./rows.ts";

/** The visitor's open order. Kept in the session — ctx.settings is writable by the visitor,
 *  who could otherwise point their cart at someone else's order. */
export async function cart(ctx: Ctx, create = true): Promise<Order | undefined> {
  const table = ctx.app.db.table("shp3_order");
  const stored = ctx.sess.data.shp3.cartId();
  let order = stored ? await table.get<Order>(stored) : undefined;

  // An open order of the logged-in user is the same cart on the next device.
  if (!order && ctx.userId) {
    const id = await ctx.app.db.one`SELECT id FROM shp3_order WHERE usr_id = ${ctx.userId} AND time_ordered = ${0} LIMIT 1`;
    if (id) order = await table.get<Order>(id);
  }
  if (order?.time_ordered) order = undefined; // placed meanwhile — that cart is spent
  if (!order) {
    if (!create) return;
    order = await table.add<Order>({ usr_id: ctx.userId, time_created: unixTime() });
  }
  if (order!.$id !== String(stored)) ctx.sess.data.shp3.cartId(order!.$id);
  order!.lang = ctx.lang;
  return order;
}

/** Logging in must not lose what the guest collected: the anonymous cart becomes the user's,
 *  and their older open ones are released so cart() cannot pick the wrong one. */
export async function adoptCart(app: App, e: { oldSession: Record<string, any>; usrId: number }): Promise<void> {
  const id = e.oldSession.shp3?.cartId;
  if (!id) return;
  const order = await app.db.table("shp3_order").get<Order>(id);
  if (!order || order.time_ordered || order.usr_id) return;
  if (!(await order.items()).length) return;
  await app.db.exec`UPDATE shp3_order SET usr_id = ${0} WHERE usr_id = ${e.usrId} AND time_ordered = ${0}`;
  order.usr_id = e.usrId;
  await order.$save();
}
