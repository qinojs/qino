import { test } from "node:test";
import { assert } from "@qino/qino/tests";
import { cms as cmsOf } from "@qino/qino/cms";

import { asVisitor, withShop } from "../../tests/app.ts";
import { cms } from "../plugin.ts";

test("the address form: autocomplete as the browsers know it, the city is no region", async () => {
  await withShop(["cms.cont.shop.address"], async (app) => {
    await asVisitor(app, async (ctx) => {
      const node = await cmsOf(app).node(10);
      const out = String(await cms.node.render(node, { ctx }));
      assert(out.includes('name="addressLocality" autocomplete="billing address-level2"'));
      assert(out.includes('name="postalCode" autocomplete="billing postal-code"'));
      assert(!out.includes("address-level1"));
    });
  });
});
