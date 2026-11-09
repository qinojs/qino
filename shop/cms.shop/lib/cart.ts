import { unixTime } from "@qino/qino";

import { country, currencyFor, taxIncluded } from "./shop.ts";

import type { App, Ctx } from "@qino/qino";
import type { Order } from "./rows.ts";

/** A customer's cart starts from the address they keep (user.profile). Stored, so it also counts
 *  when the form is passed without a change. */
async function billFromUser(app: App, order: Order, usrId: number): Promise<void> {
  if (order.bill) return;
  const u = await app.db.row`SELECT * FROM usr WHERE id = ${usrId}`;
  if (!u?.street_address) return;
  const str = (v: unknown) => String(v ?? "") || undefined;
  const organization = str(u.organization), givenName = str(u.firstname), familyName = str(u.lastname);
  await order.setParty("bill", {
    name: organization || [givenName, familyName].filter(Boolean).join(" ") || undefined,
    givenName, familyName, organization, email: str(u.email),
    address: { streetAddress: String(u.street_address), postalCode: String(u.postal_code ?? ""), addressLocality: String(u.address_locality ?? ""), addressCountry: String(u.address_country ?? "") },
  });
}

/** The visitor's cart, its id kept in the session (ctx.settings is writable by the visitor). */
export async function cart(ctx: Ctx, create = true): Promise<Order | undefined> {
  const app = ctx.app, table = app.db.table("shop_order");
  const session = ctx.sess.data["cms.shop"];
  const stored = session.cart();
  let order = stored ? (await table.get<Order>(stored))?.forget() : undefined;

  // An open cart of the logged-in user is the same cart on the next device.
  if (!order && ctx.userId) {
    const id = await app.db.one`SELECT id FROM shop_order WHERE usr_id = ${ctx.userId} AND status = ${"cart"} ORDER BY id DESC LIMIT 1`;
    if (id) order = (await table.get<Order>(id))?.forget();
  }
  if (order && order.status !== "cart") order = undefined; // placed meanwhile — that cart is spent
  if (!order) {
    if (!create) return;
    const where = await country(app);
    const time = unixTime();
    order = await table.add<Order>({
      usr_id: ctx.userId || null,
      status: "cart",
      country: where,
      currency: (await currencyFor(app, where))?.$id ?? "",
      tax_included: await taxIncluded(app),
      lang: ctx.lang,
      created: time,
      changed: time,
    });
    await app.fire("shop:cart", { order: order!, ctx }); // a fresh cart: a module may know the country better
    if (ctx.userId) await billFromUser(app, order!, Number(ctx.userId));
  }
  if (order!.$id !== String(stored ?? "")) session.cart(order!.$id);
  if (order!.lang !== ctx.lang) order!.lang = ctx.lang;
  return order;
}

/** On login the guest cart becomes the user's; older open carts of the user are released. */
export async function adopt(app: App, e: { oldSession: Record<string, any>; usrId: number }): Promise<void> {
  const id = e.oldSession["cms.shop"]?.cart;
  if (!id) return;
  const order = await app.db.table("shop_order").get<Order>(id);
  if (!order || order.status !== "cart" || order.usr_id) return;
  if (!(await order.lines()).length) return;
  await app.db.exec`UPDATE shop_order SET usr_id = ${null} WHERE usr_id = ${e.usrId} AND status = ${"cart"}`;
  order.usr_id = e.usrId;
  await billFromUser(app, order, e.usrId);
  await order.reprice(); // group prices
}
