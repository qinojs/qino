import { test } from "node:test";
import { cms as cmsOf, cmsCtx } from "@qino/qino/cms";
import { assert, assertEquals } from "@qino/qino/tests";

import { cms } from "../plugin.ts";
import { asVisitor, withShop } from "../../tests/app.ts";

const structured = (head: string) => JSON.parse(head.match(/<script type=application\/ld\+json>(.*?)<\/script>/s)?.[1] ?? "null");

test("a product tells search engines the price it shows, only where the page is about it", () =>
  withShop(["cms.cont.shop.category", "cms.cont.shop.product"], async (app) => {
    await app.db.table("shop_product").update({ id: 10, sku: "CUP-1", brand: "Qino" });
    await asVisitor(app, async (ctx) => {
      const node = await cmsOf(app).node(10);
      cmsCtx(ctx).requestedNode = node;
      const out = String(await cms.node.render(node, { ctx }));
      const data = structured(ctx.res.html.head);
      assertEquals(data["@type"], "Product");
      assertEquals([data.sku, data.brand.name], ["CUP-1", "Qino"]);
      assertEquals(data.offers, [{ "@type": "Offer", price: "24.50", priceCurrency: "CHF", availability: "https://schema.org/InStock" }]);
      assert(out.includes("24.50"), "the same price as on the page");
    });
    // in a category: silent in its list, told at the product's own address
    const page = await (await cmsOf(app).node(1)).createChild({ access: 1 });
    const category = await page.cont("main", "cms.cont.shop.category");
    const cup = await category.createCont({ module: "cms.cont.shop.product" });
    await app.db.table("shop_product").insert({ id: cup.id, price: 900 });
    for (const [asked, told] of [[page, null], [cup, "9.00"]] as const) await asVisitor(app, async (ctx) => {
      cmsCtx(ctx).requestedNode = asked;
      await cms.node.render(cup, { ctx });
      assertEquals(structured(ctx.res.html.head)?.offers[0].price ?? null, told);
    });
  }));
