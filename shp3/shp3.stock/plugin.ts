import { hee, type App } from "../../module/core/mod.ts";
import { mail } from "../../module/mail/mod.ts";
import { Product, shp3, type Order, type OrderItem } from "../shp3/mod.ts";
import dbSchema from "./dbschema.json" with { type: "json" };

export const name = "shp3.stock";
export const description = "Keeps stock per product, caps what can be ordered, and warns when it runs low.";
export const needs = ["shp3", "mail"];
export { dbSchema };

export const settingsSchema = {
  properties: {
    trigger: { type: "integer", default: 0, description: "Default stock level that triggers the warning mail." },
    notification_email: { type: "string", description: "Who to warn, comma separated." },
  },
};

/** The columns this module adds belong to the product, so they extend its class. */
class StockProduct extends Product {
  declare stock: number;
  declare stock_is_fix: boolean;
  declare stock_trigger: number | null;
}

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  app.db.table("shp3_product").rowClass = StockProduct;

  // A fixed stock is a hard limit — nobody orders what is not there.
  shp3(app).on("item-quantity", async (e: { item: OrderItem; quantity: number }) => {
    const product = await e.item.product() as StockProduct | undefined;
    if (product?.stock_is_fix) e.quantity = Math.min(product.stock, e.quantity);
  }, { signal });

  shp3(app).on("ordered", async ({ order }: { order: Order }) => {
    for (const item of await order.items()) {
      const product = await item.product() as StockProduct | undefined;
      if (!product) continue;
      product.stock -= item.quantity;
      const trigger = product.stock_trigger ?? Number(await app.settings["shp3.stock"].trigger ?? 0);
      if (product.stock <= trigger) await warn(app, order, product, trigger).catch((e) => console.error("shp3.stock: warning not sent:", e));
    }
  }, { signal });
}

async function warn(app: App, order: Order, product: StockProduct, trigger: number) {
  const to = String(await app.settings["shp3.stock"].notification_email ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!to.length) return;
  const title = await app.db.one`SELECT name FROM page WHERE id = ${product.$id}`;
  const msg = await mail(app).create({
    subject: `${await app.t`Minimum stock reached`}: ${title ?? product.$id}`,
    html: `<table>
      <tr><td><b>${hee(await app.t`Product`)}</b><td>${hee(title)}
      <tr><td><b>${hee(await app.t`Order`)}</b><td>${hee(order.$id)}
      <tr><td><b>${hee(await app.t`In stock`)}</b><td>${product.stock}
      <tr><td><b>${hee(await app.t`Minimum`)}</b><td>${trigger}
    </table>`,
  });
  for (const email of to) msg.addTo(email);
  await msg.send();
}
