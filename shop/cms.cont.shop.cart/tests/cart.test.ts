import { test } from "node:test";
import { assert, assertStringIncludes } from "@qino/qino/tests";
import { cms as cmsOf } from "@qino/qino/cms";
import { cart } from "@qino/qino/cms.shop";

import { asVisitor, withShop } from "../../tests/app.ts";
import { cms } from "../plugin.ts";

import type { Product } from "@qino/qino/cms.shop";

test("cart lines show their product's image", async () => {
  await withShop(["cms.cont.shop.cart"], async (app) => {
    const product = await cmsOf(app).node(10);
    const photo = await app.dbFiles.add(new File([new Uint8Array([137, 80, 78, 71])], "cup.png", { type: "image/png" }));
    await asVisitor(app, async (ctx) => {
      const shown = async () => String(await cms.node.render(product, { ctx }));
      await (await cart(ctx))!.add((await app.db.table("shop_product").get<Product>(10))!, { quantity: 1 });
      assert(!(await shown()).includes("<img"));
      await product.addFile(photo, "image");
      const out = await shown();
      assertStringIncludes(out, "<cms-image");
      assertStringIncludes(out, `/dbFile/${photo.id}/`);
    });
  });
});
