import { test } from "node:test";
import { assert, assertStringIncludes } from "@qino/qino/tests";
import { cms } from "@qino/qino/cms";
import { backend } from "@qino/qino/cms.backend";

import { asVisitor, withShop } from "../../tests/app.ts";
import { backendDashboardWidget } from "../plugin.ts";

test("the dashboard widget lists the latest placed orders that are not canceled, each linked", async () => {
  await withShop(["cms.backend", "cms.backend.shop", "cms.backend.shop.orders"], async (app) => {
    const orders = app.db.table("shop_order");
    for (const [id, status] of [[1, "cart"], [2, "ordered"], [3, "paid"], [4, "canceled"]] as const) {
      await orders.insert({ id, status, currency: "CHF", total: 1000 * id, ordered: id });
    }
    await asVisitor(app, async () => {
      const page = await cms(app).nodeByModule("cms.backend.shop");
      assert(page);
      const out = String(await backendDashboardWidget(app, page));
      const url = await (await cms(app).nodeByModule("cms.backend.shop.orders"))!.url();
      assertStringIncludes(out, `<a href="${backend.toUrl(url, { id: 3 })}">3</a>`);
      assertStringIncludes(out, `<a href="${backend.toUrl(url, { id: 2 })}">2</a>`);
      assert(out.indexOf("?id=3") < out.indexOf("?id=2")); // newest first
      assert(!out.includes("?id=1") && !out.includes("?id=4"));
    });
  });
});
