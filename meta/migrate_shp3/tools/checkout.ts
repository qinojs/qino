/* One order through the shop's API, on a product with options if there is one, then every page of
   the checkout rendered. Run from a site's folder (its server.ts), not next to the running server:
   deno run -A ../../qinojs/qino/meta/migrate_shp3/tools/checkout.ts [country] */
import { Ctx, invoke, requestStorage } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { cart } from "@qino/qino/cms.shop";

import type { ApiTree, App } from "@qino/qino";

const { app } = await import(`file://${Deno.cwd()}/server.ts`) as { app: App };
const api = app.modules.get("cms.shop")!.plugin.api as ApiTree;
await app.settings.core.url("http://shop.test/");
const country = Deno.args[0] ?? "CH";
const ctx = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
ctx.sess = await app.sessions.load();
await requestStorage.run(ctx, async () => {
  const db = app.db;
  const options = app.modules.get("cms.shop.options") ? await db.query`SELECT product_id, name, value FROM shop_option_value ORDER BY product_id, sort LIMIT 1` : [];
  const id = options[0]?.product_id ?? await db.one`SELECT p.id FROM shop_product p JOIN page ON page.id = p.id WHERE p.price > 0 LIMIT 1`;
  const data = options[0] ? { options: { [String(options[0].name)]: String(options[0].value) } } : undefined;
  console.log("add", id, data, await invoke(api, "POST", "/cart/lines", { product: String(id), quantity: 2, data }));
  const party = { honorificPrefix: "Frau", givenName: "Anna", familyName: "Muster", email: "anna@example.test", address: { streetAddress: "Teststrasse 1", postalCode: "9000", addressLocality: "St. Gallen", addressCountry: country } };
  await invoke(api, "PUT", "/cart/party", { kind: "bill", party });
  const order = (await cart(ctx))!;
  console.log("lines", (await order.lines()).map((l) => [l.name, l.quantity, l.price]), "extras", (await order.extras()).map((x) => [x.key, x.name, x.price]));
  console.log("shippings", await order.shippings(), "payments", await order.payments());
  const [shipping] = await order.shippings(), [payment] = await order.payments();
  if (shipping) await invoke(api, "PUT", "/cart/shipping", { value: shipping.name });
  if (payment) await invoke(api, "PUT", "/cart/payment", { value: payment.name });
  const pages = await db.query`SELECT id, module FROM page WHERE module LIKE 'cms.cont.shop.%'`;
  for (const page of pages) {
    const out = String(await (await cms(app).node(Number(page.id))).html()).replace(/\s+/g, " ");
    console.log(`${page.id} ${page.module}: ${out.length} chars${out.includes("[object") ? " OBJECT" : ""} — ${out.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 140)}`);
  }
  const placed = await order.place();
  console.log("placed", placed, "status", order.status, "total", order.currency, order.total, "shipping", order.shipping, "payment", order.payment);
  console.log("invoice", await db.row`SELECT id, number, status FROM invoice WHERE ref = ${`cms.shop:${order.$id}`}`.catch(() => undefined));
});
Deno.exit(0);
