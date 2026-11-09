/* Prices of the migrated shop against what PHP charged, run from a site's folder (its server.ts): the most recent orders are put together
   again as carts (same products, variants, amounts, country, currency, customer) and every unit
   price, surcharge and shipping cost is compared with the one stored at the time. A price that
   changed since shows up too — hence only recent orders. After the first start:
   deno run -A ../../qinojs/qino/meta/migrate_shp3/tools/verify.ts [count] */
import { Ctx, requestStorage } from "@qino/qino";

import type { App } from "@qino/qino";
import type { Order, Product } from "@qino/qino/cms.shop";

const { app } = await import(`file://${Deno.cwd()}/server.ts`) as { app: App };

const count = Number(Deno.args[0] ?? 60);
const ctx = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
ctx.sess = await app.sessions.load();
await requestStorage.run(ctx, run);
Deno.exit(0);

async function run() {
  const db = app.db;
  const orders = await db.table("shop_order").all<Order>`WHERE status <> ${"cart"} ORDER BY id DESC LIMIT ${count}`;
  let lines = 0, same = 0;
  const off: string[] = [];

  for (const old of orders) {
    const cart = (await db.table("shop_order").add<Order>({
      status: "cart", country: old.country, currency: old.currency, usr_id: old.usr_id, tax_included: true, lang: old.lang,
    }))!;
    for (const line of await old.lines()) {
      const product = await db.table("shop_product").get<Product>(line.product_id);
      if (product) await cart.add(product, { variant: await product.variant(line.variant_id), quantity: Number(line.quantity), data: line.dataOf() });
    }
    // the price at the time of the order: an action of back then counts
    for (const line of await cart.lines()) {
      const product = (await line.product())!;
      line.price = (await product.prices({ variant: await line.variant(), quantity: line.quantity, order: cart, data: line.dataOf(), time: old.ordered })).price;
    }
    const before = await old.lines();
    for (const line of await cart.lines()) {
      const was = before.find((l) => l.product_id === line.product_id && String(l.variant_id ?? "") === String(line.variant_id ?? "") && JSON.stringify(l.dataOf()) === JSON.stringify(line.dataOf()));
      if (!was) continue;
      lines++;
      // PHP kept half cents, qino rounds a reduced price to the cent
      if (Math.abs(Number(was.price) - Number(line.price)) <= 0.5) same++;
      else off.push(`order ${old.$id} ${old.currency} ${was.name} ×${was.quantity}: was ${Number(was.price).toFixed(2)}, now ${Number(line.price).toFixed(2)}`);
    }
    const was = await old.extras(), now = await cart.extras();
    for (const x of was.filter((x) => x.key !== "shipping")) { // shipping depends on the method, below
      const n = now.find((n) => n.key === x.key);
      if (!n || Math.abs(n.price - x.price) >= 0.5) off.push(`order ${old.$id} extra ${x.key}: was ${x.price.toFixed(2)}, now ${n?.price.toFixed(2) ?? "none"}`);
    }
    if (old.shipping) {
      const charged = was.find((x) => x.key === "shipping")?.price ?? 0, cost = await cart.shippingCost(old.shipping);
      if (Math.abs(charged - cost) >= 1) off.push(`order ${old.$id} shipping ${old.shipping} (${old.country}): was ${charged.toFixed(2)}, now ${cost.toFixed(2)}`);
    }
    await db.exec`DELETE FROM shop_order_line WHERE order_id = ${cart.$id}`;
    await db.exec`DELETE FROM shop_order WHERE id = ${cart.$id}`;
  }

  console.log(`${orders.length} orders, ${lines} lines, ${same} unit prices the same, ${off.length} differences`);
  for (const line of off.slice(0, 60)) console.log("  " + line);
  if (off.length > 60) console.log(`  … ${off.length - 60} more`);
}
