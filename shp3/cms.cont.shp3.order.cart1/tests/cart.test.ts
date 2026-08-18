import { assertEquals, assertStringIncludes } from "@std/assert";
import { App, Ctx, requestStorage } from "@qino/qino";
import { cart, shp3 } from "@qino/qino/shp3";

import { cms as panel } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

async function shop() {
  const app = new App({ db: "sqlite::memory:", dir: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../../module/store.json")).add("cms").add("cron").add("locale.country").add("locale.currency");
  app.modules.add(import.meta.resolve("../../shp3/plugin.ts"), "shp3");
  app.modules.add(import.meta.resolve("../../shp3.shipping.pickup/plugin.ts"), "shp3.shipping.pickup");
  await app.init();
  await app.db.table("page").insert({ id: 10, name: "Cup", access: 1 });
  await app.db.table("shp3_product").insert({ id: 10, price: 12, weight: 0.5 });
  return app;
}

// The cont only reads its own settings; everything else it needs is the cart.
const node = (app: App) => ({ app, settings: { editable: () => Promise.resolve(true) } }) as unknown as Node;

Deno.test("cart1: what the shop adds itself is a line of its own", async () => {
  await using app = await shop();
  const ctx = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
  await requestStorage.run(ctx, async () => {
    // a shipping rule that costs something — it is in the total, so it has to be visible
    shp3(app).on("shipping-cost", (e) => { e.cost = 7; });
    const order = (await cart(ctx))!;
    await order.itemAdd(10, 1);

    const html = String(await panel.node.render(node(app), { ctx } as never));
    assertStringIncludes(html, "-generated");
    assertStringIncludes(html, "7.00"); // the shipping line, not only inside the total
    assertEquals(html.includes("[object Promise]"), false);
  });
});

Deno.test("cart1: an empty cart says so and shows no table", async () => {
  await using app = await shop();
  const ctx = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
  await requestStorage.run(ctx, async () => {
    const html = String(await panel.node.render(node(app), { ctx } as never));
    assertEquals(html.includes("<table"), false);
  });
});
