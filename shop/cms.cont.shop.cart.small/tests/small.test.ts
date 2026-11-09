import { test } from "node:test";
import { assert } from "@qino/qino/tests";
import { cms as cmsOf } from "@qino/qino/cms";

import { asVisitor, withShop } from "../../tests/app.ts";
import { cart } from "@qino/qino/cms.shop";
import { cms } from "../plugin.ts";

import type { Product } from "@qino/qino/cms.shop";

test("the small cart: empty, then as much as its mode says", async () => {
  await withShop(["cms.cont.shop.cart.small"], async (app) => {
    await asVisitor(app, async (ctx) => {
      const node = await cmsOf(app).node(10);
      const shown = async (mode?: string) => {
        if (mode) await node.settings.mode(mode);
        return String(await cms.node.render(node, { ctx }));
      };
      assert((await shown()).includes("-empty"));
      await (await cart(ctx))!.add((await app.db.table("shop_product").get<Product>(10))!, { quantity: 2 });
      assert((await shown("short")).includes('-num>1<'));
      assert((await shown("count")).includes("CHF 49.00"));
      assert((await shown("lines")).includes("<table>"));
    });
  });
});
