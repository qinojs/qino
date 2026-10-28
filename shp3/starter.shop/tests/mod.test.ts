import { App } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assert, assertEquals } from "@qino/qino/tests";

import manifest from "../manifest.json" with { type: "json" };

const quiet = { sanitizeOps: false, sanitizeResources: false };

Deno.test("starter.shop: every module it brings is in a store", async () => {
  const names = async (url: string) => Object.keys(JSON.parse(await Deno.readTextFile(new URL(url, import.meta.url))).modules);
  const offered = new Set([...await names("../../store.json"), ...await names("../../../module/store.json")]);
  assertEquals(manifest.dependencies.filter((mod) => !offered.has(mod)), []);
});

Deno.test({
  name: "starter.shop: a shop with products, cart and checkout, in the navigation before contact",
  ...quiet,
  fn: async () => {
    const dir = await Deno.makeTempDir() + "/";
    const app = new App({ dir, db: `sqlite:${dir}site.sqlite` });
    app.stores.add(import.meta.resolve("../../../module/store.json")).add("cms");
    app.stores.add(import.meta.resolve("../../store.json")).add("starter.shop");
    await app.init();
    try {
      const cm = cms(app);
      const get = async (path: string) => {
        const res = await app.fetch(new Request("http://localhost" + path));
        return { status: res.status, body: await res.text() };
      };
      const shop = await get("/en/shop");
      assertEquals(shop.status, 200);
      assertEquals(shop.body.match(/shp3-add/g)?.length, 3, "three products to put in the cart");
      assert(shop.body.includes("CHF 29.00"));
      assertEquals((await get("/en/cart")).status, 200);
      const checkout = await get("/en/cart/checkout");
      assert(checkout.body.includes("Checkout"));

      const nav = (await (await cm.node(1)).children()).values().filter((p) => p.vs.visible).map((p) => p.vs.name).toArray();
      assertEquals(nav, ["home", "shop", "cart", "contact", "first-steps"]);

      assertEquals((await cm.nodesByName("todo-shop")).size, 1, "an item on the checklist");
      await app.modules.repair("starter.shop");
      assertEquals((await cm.nodesByModule("cms.cont.shp3.product.default")).size, 3, "repair adds no products");
      assertEquals((await cm.nodesByName("todo-shop")).size, 1, "nor checklist items");
    } finally {
      await app.db.close();
      await Deno.remove(dir, { recursive: true });
    }
  },
});
