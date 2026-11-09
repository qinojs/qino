import { test } from "node:test";
import { assert, assertEquals } from "@qino/qino/tests";
import { Ctx } from "@qino/qino";
import { cms as cmsOf } from "@qino/qino/cms";

import { asVisitor, withShop } from "../../tests/app.ts";
import { cart } from "@qino/qino/cms.shop";
import { cms } from "../plugin.ts";

import type { Product } from "@qino/qino/cms.shop";

const at = (app: Parameters<typeof asVisitor>[0], url: string) => Ctx.create(app, new Request(url), { appUrl: "/" });

test("a customer sees their own orders only; a new cart starts from their address", async () => {
  await withShop(["cms.cont.shop.my.orders"], async (app) => {
    const usr = Number(await app.db.table("usr").insert({ email: "anna@example.test", firstname: "Anna", lastname: "Muster", street_address: "Weg 1", postal_code: "9000", address_locality: "St. Gallen", address_country: "CH" }));
    const other = Number(await app.db.table("usr").insert({ email: "ben@example.test" }));
    const product = (await app.db.table("shop_product").get<Product>(10))!;
    await asVisitor(app, async (ctx) => {
      await ctx.authenticate(usr, "test");
      const order = (await cart(ctx))!;
      assertEquals(order.party("bill")?.address?.streetAddress, "Weg 1");
      await order.add(product);
      assertEquals((await order.place()).ok, true);
      const node = await cmsOf(app).node(10);
      assert(String(await cms.node.render(node, { ctx })).includes(`shop_order=${order.$id}`));
    }, await at(app, "http://shop.test/"));
    const id = await app.db.one`SELECT id FROM shop_order WHERE status = 'ordered'`;
    await asVisitor(app, async (ctx) => { // someone else asks for it by number: the list, empty
      await ctx.authenticate(other, "test");
      const out = String(await cms.node.render(await cmsOf(app).node(10), { ctx }));
      assert(!out.includes("<h2>"));
      assert(!out.includes(`shop_order=${id}`));
    }, await at(app, `http://shop.test/?shop_order=${id}`));
  });
});
