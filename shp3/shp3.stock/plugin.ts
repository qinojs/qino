import { hee } from "@qino/qino";
import { mail } from "@qino/qino/mail";
import { shp3 } from "@qino/qino/shp3";

import type { App } from "@qino/qino";
import type { Order, Product } from "@qino/qino/shp3";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const settingsSchema = {
  properties: {
    trigger: { type: "integer", default: 0, description: "Default stock level that triggers the warning mail." },
    notification_email: { type: "string", description: "Who to warn, comma separated." },
  },
};

// The columns this module adds belong to the product itself — there is no second kind of product.
// The accessors come from the table, this only tells the compiler about them.
declare module "@qino/qino/shp3" {
  interface Product {
    stock: number;
    stock_is_fix: boolean;
    stock_trigger: number | null;
  }
}

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  // A fixed stock is a hard limit — nobody orders what is not there.
  shp3(app).on("item-quantity", async (e) => {
    const product = await e.item.product();
    if (product?.stock_is_fix) e.quantity = Math.min(product.stock, e.quantity);
  }, { signal });

  shp3(app).on("ordered", async ({ order }) => {
    for (const item of await order.items()) {
      const product = await item.product();
      if (!product) continue;
      product.stock -= item.quantity;
      const trigger = product.stock_trigger ?? Number(await app.settings["shp3.stock"].trigger ?? 0);
      if (product.stock <= trigger) await warn(app, order, product, trigger).catch((e) => console.error("shp3.stock: warning not sent:", e));
    }
  }, { signal });
}

async function warn(app: App, order: Order, product: Product, trigger: number) {
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
