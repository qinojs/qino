import { test } from "node:test";
import { assertEquals, testContext } from "@qino/qino/tests";
import { cms } from "@qino/qino/cms";

import { asVisitor, withShop } from "../../tests/app.ts";
import { cms as plugin } from "../plugin.ts";

test("a product changes only with the right to edit its node, in the list as on its own page", async () => {
  await withShop(["cms.backend", "cms.backend.shop", "cms.backend.shop.products"], async (app) => {
    const admin = Number(await app.db.table("usr").insert({ username: "admin", superuser: true }));
    const call = async (vars: Record<string, unknown>, userId?: number) => {
      const ctx = userId ? await testContext({ app, userId, set: { app } }) : undefined;
      return asVisitor(app, async () => plugin.node.api(await cms(app).node(10), vars), ctx);
    };
    const price = { list: true, table: "shop_product", row: "10", values: { price: "30" } };
    const variant = { id: 10, table: "shop_variant", values: { sort: "1" } };
    // the product's page 10 may be read by all, edited by none but a superuser
    assertEquals(await call(price), { ok: false });
    assertEquals(await call(variant), { ok: false });
    assertEquals(Number(await app.db.one`SELECT price FROM shop_product WHERE id = ${10}`), 2450);
    assertEquals(await call(price, admin), { ok: true });
    assertEquals(await call(variant, admin), { ok: true });
    assertEquals(Number(await app.db.one`SELECT price FROM shop_product WHERE id = ${10}`), 3000);
    assertEquals(Number(await app.db.one`SELECT COUNT(*) FROM shop_variant WHERE product_id = ${10}`), 1);
    // no product, nothing to change
    assertEquals(await call({ id: 999, table: "shop_variant", values: { sort: "1" } }, admin), { ok: false });
  });
});
