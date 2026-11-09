import { test } from "node:test";
import { App, fs } from "@qino/qino";
import { cms } from "@qino/qino/cms";
import { assert, assertEquals } from "@qino/qino/tests";

import manifest from "../manifest.json" with { type: "json" };


test("starter.shop: every module it brings is in a store", async () => {
  const names = async (url: string) => Object.keys(JSON.parse(await fs.text(import.meta.dirname + "/" + url)).modules);
  const offered = new Set([...await names("../../store.json"), ...await names("../../../module/store.json"), ...await names("../../../fin/store.json")]);
  assertEquals(manifest.dependencies.filter((mod) => !offered.has(mod)), []);
});

test("starter.shop: a shop with products, cart and checkout, in the navigation before contact", async () => {
  const dir = await fs.tempDir() + "/";
  const app = new App({ dir, db: `sqlite:${dir}site.sqlite` });
  app.stores.add(import.meta.resolve("../../../module/store.json")).add("cms").add("cms.seo");
  app.stores.add(import.meta.resolve("../../../fin/store.json"));
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
    assertEquals(shop.body.match(/shop-add/g)?.length, 3, "three products to put in the cart");
    assert(shop.body.includes("CHF 29.00"));
    assertEquals((await get("/en/cart")).status, 200);
    const one = await get("/en/shop/sample-product-1");
    assertEquals(one.status, 200);
    assertEquals(one.body.match(/shop-add/g)?.length, 1, "at its own address, the product alone");
    assert((await get("/sitemap.xml")).body.includes("/en/shop/sample-product-1"), "in the sitemap");
    const anchor = [...(await cm.nodesByModule("cms.cont.shop.cart")).values()][0];
    assertEquals((await anchor.urlSeo("en"))[0], "#", "what is not listed by a category stays an anchor");
    const category = [...(await cm.nodesByModule("cms.cont.shop.category")).values()][0];
    await (await category.page()).title("en", "Store");
    assertEquals((await get("/en/store/sample-product-1")).status, 200, "the address follows its page");
    assertEquals((await get("/en/shop/sample-product-1")).status, 404);
    await (await category.page()).title("en", "Shop");
    const checkout = await get("/en/cart/checkout");
    assert(checkout.body.includes("Checkout"));

    const nav = (await (await cm.node(1)).children()).values().filter((p) => p.vs.visible).map((p) => p.vs.name).toArray();
    assertEquals(nav, ["home", "shop", "cart", "contact", "first-steps"]);

    assertEquals((await cm.nodesByName("todo-shop")).size, 1, "an item on the checklist");
    await app.modules.repair("starter.shop");
    assertEquals((await cm.nodesByModule("cms.cont.shop.product")).size, 3, "repair adds no products");
    assertEquals((await cm.nodesByName("todo-shop")).size, 1, "nor checklist items");
  } finally {
    await app.db.close();
    await fs.remove(dir, { recursive: true });
  }
});
