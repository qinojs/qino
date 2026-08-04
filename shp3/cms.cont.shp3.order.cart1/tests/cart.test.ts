import { assertEquals } from "@std/assert";
import { App, Ctx, requestStorage } from "../../../module/core/mod.ts";
import { cart } from "../../shp3/mod.ts";
import cartApi from "../nodeApi.ts";
import { name, cms } from "../plugin.ts";

async function shop() {
  const app = new App({ db: "sqlite::memory:", appPATH: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../../module/store.json")).add("cms");
  app.modules.add(import.meta.resolve("../../shp3/plugin.ts"), "shp3");
  app.modules.add(import.meta.resolve("../plugin.ts"), name);
  await app.init();
  await app.db.table("page").insert({ id: 10, name: "Cup" });
  await app.db.table("shp3_product").insert({ id: 10, price: 12, weight: 0.5 });
  return app;
}

const context = (app: App) =>
  Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });

Deno.test("cart: the module is wired", () => {
  assertEquals(name, "cms.cont.shp3.order.cart1");
  assertEquals(typeof cms.node.api, "function");
  assertEquals(typeof cms.node.render, "function");
});

Deno.test("cart: quantity and removal go through the visitor's own order", async () => {
  const app = await shop();
  try {
    const ctx = await context(app);
    await requestStorage.run(ctx, async () => {
      const order = (await cart(ctx))!;
      const item = await order.itemAdd(10, 1);
      await app.db.flush();

      assertEquals(await cartApi({ app } as never, { quantity: String(item), value: "3" }), { gross: "36.00" });
      assertEquals(item.quantity, 3);

      // an id that is not in this order is refused, not applied
      assertEquals(await cartApi({ app } as never, { quantity: "999", value: "1" }), false);
      assertEquals(await cartApi({ app } as never, { remove: "999" }), false);

      assertEquals(await cartApi({ app } as never, { remove: String(item) }), { gross: "0.00" });
      assertEquals((await order.items()).length, 0);
    });
  } finally {
    await app.db.close();
  }
});

Deno.test("cart: quantity 0 removes the line", async () => {
  const app = await shop();
  try {
    const ctx = await context(app);
    await requestStorage.run(ctx, async () => {
      const order = (await cart(ctx))!;
      const item = await order.itemAdd(10, 2);
      await app.db.flush();
      await cartApi({ app } as never, { quantity: String(item), value: "0" });
      assertEquals((await order.items()).length, 0);
    });
  } finally {
    await app.db.close();
  }
});
