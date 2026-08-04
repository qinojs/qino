import { assertEquals } from "@std/assert";
import { App, Ctx, requestStorage } from "../../../module/core/mod.ts";
import { cart } from "../../shp3/mod.ts";
import productApi from "../nodeApi.ts";
import { name, cms } from "../plugin.ts";

async function shop() {
  const app = new App({ db: "sqlite::memory:", appPATH: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../../module/store.json")).add("cms");
  app.modules.add(import.meta.resolve("../../shp3/plugin.ts"), "shp3");
  app.modules.add(import.meta.resolve("../plugin.ts"), name);
  await app.init();
  await app.db.table("page").insert({ id: 10, name: "Cup", access: 1 });
  await app.db.table("shp3_product").insert({ id: 10, price: 12, weight: 0.5 });
  return app;
}

Deno.test("product: the module is wired", () => {
  assertEquals(name, "cms.cont.shp3.product.default");
  assertEquals(typeof cms.node.api, "function");
});

Deno.test("product: adding puts the page's own product into the cart", async () => {
  const app = await shop();
  try {
    const ctx = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
    await requestStorage.run(ctx, async () => {
      const node = { id: 10, app, access: () => 1 } as never;
      assertEquals(await productApi(node, { add: 1, quantity: "2" }), { item: "1", quantity: 2, count: 1 });
      // adding again lands on the same line, no second row
      assertEquals(await productApi(node, { add: 1, quantity: "1" }), { item: "1", quantity: 3, count: 1 });
      assertEquals(await productApi(node, { nothing: 1 }), false);

      const order = (await cart(ctx))!;
      assertEquals((await order.items()).length, 1);
      assertEquals((await order.costs()).gross, 36);
    });
  } finally {
    await app.db.close();
  }
});
