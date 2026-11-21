import { test } from "node:test";
import { cms as cmsOf, cmsCtx } from "@qino/qino/cms";
import { assert, assertEquals, assertStringIncludes } from "@qino/qino/tests";

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
    // the module makes it a product: the row is there with the node
    const cup = await category.createCont({ module: "cms.cont.shop.product" });
    await app.db.table("shop_product").update(cup.id, { price: 900 });
    for (const [asked, told] of [[page, null], [cup, "9.00"]] as const) await asVisitor(app, async (ctx) => {
      cmsCtx(ctx).requestedNode = asked;
      await cms.node.render(cup, { ctx });
      assertEquals(structured(ctx.res.html.head)?.offers[0].price ?? null, told);
    });
  }));

test("product image prefers the named slot and keeps legacy attachments visible", () =>
  withShop(["cms.cont.shop.product"], async (app) => {
    const node = await cmsOf(app).node(10);
    const file = (name: string) => app.dbFiles.add(new File([`<svg xmlns="http://www.w3.org/2000/svg" id="${name}"/>`], `${name}.svg`, { type: "image/svg+xml" }));
    const old = await file("legacy"), main = await file("main");
    await node.title("en", "Cup & saucer");
    await node.addFile(old, "old-gallery-key");
    for (const [image, id] of [[old, "legacy"], [main, "main"]] as const) {
      if (image === main) await node.addFile(main, "image");
      await asVisitor(app, async (ctx) => {
        cmsCtx(ctx).requestedNode = node;
        const out = String(await cms.node.render(node, { ctx }));
        assertStringIncludes(out, `id%3D%22${id}%22`); // cms-image inlines small SVGs
        assertStringIncludes(out, 'alt="Cup &amp; saucer"');
        assertStringIncludes(structured(ctx.res.html.head).image, `http://shop.test/dbFile/${image.id}/`);
      });
    }
    assertEquals([...(await node.files()).keys()].sort(), ["image", "old-gallery-key"]);
  }));

test("a product nobody can order has no button to try", () =>
  withShop(["cms.cont.shop.product", "cms.shop.stock"], async (app) => {
    const node = await cmsOf(app).node(10);
    const shown = () => asVisitor(app, async (ctx) => String(await cms.node.render(node, { ctx })));
    assertStringIncludes(await shown(), "<button>");
    await app.db.table("shop_product").update(10, { stock: 0 });
    assert(!(await shown()).includes("<button>"), "sold out: the message, no button");
  }));
