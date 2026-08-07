// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "@std/assert";
import { App, Ctx, requestStorage } from "../../../module/core/mod.ts";
import { api } from "../api.ts";
import { cart } from "../mod.ts";

const call = (path: string[], verb: string, input?: unknown) =>
  (path.reduce((n: any, k) => n[k], api as any))[verb].execute(input);

async function shop() {
  const app = new App({ db: "sqlite::memory:", appPATH: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../../module/store.json")).add("cms").add("cron").add("cron").add("locale.country").add("locale.currency");
  app.modules.add(import.meta.resolve("../plugin.ts"), "shp3");
  app.modules.add(import.meta.resolve("../../shp3.shipping.pickup/plugin.ts"), "shp3.shipping.pickup");
  app.modules.add(import.meta.resolve("../../cms.cont.shp3.order.addresses2/plugin.ts"), "cms.cont.shp3.order.addresses2"); // owns the address columns
  await app.init();
  await app.db.table("page").insert({ id: 10, name: "Cup", access: 1 });
  await app.db.table("shp3_product").insert({ id: 10, price: 12, weight: 0.5 });
  return app;
}

Deno.test("shp3 api: a product goes into the cart from anywhere", async () => {
  const app = await shop();
  try {
    const ctx = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
    await requestStorage.run(ctx, async () => {
      assertEquals(await call(["cart"], "get"), { items: 0, quantity: 0, net: 0, gross: 0, currency: "", grossText: "" });

      const added = await call(["cart", "items"], "post", { product: "10", quantity: 2 });
      assertEquals(added.cart.items, 1);
      assertEquals(added.cart.quantity, 2);
      assertEquals(added.cart.gross, 24);

      // an unknown or unsellable product is refused, never silently added
      assertEquals(await call(["cart", "items"], "post", { product: "999" }), { error: "not available" });
      assertEquals((await call(["cart"], "get")).items, 1);
    });
  } finally {
    await app.db.close();
  }
});

Deno.test("shp3 api: price answers for an amount, method choices are checked", async () => {
  const app = await shop();
  try {
    const ctx = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
    await requestStorage.run(ctx, async () => {
      const prices = await call(["price"], "post", { product: "10", quantity: 3 });
      assertEquals(prices.gross, 12);
      assertEquals(prices.currency, "CHF");

      await call(["cart", "items"], "post", { product: "10" });
      assertEquals((await call(["cart", "shipping"], "put", { value: "nonsense" })), { error: "not available" });
      assertEquals((await call(["cart", "shipping"], "put", { value: "pickup" })).cart.items, 1);
      assertEquals((await cart(ctx))!.shipping, "pickup");
    });
  } finally {
    await app.db.close();
  }
});

Deno.test("shp3 api: the address only takes address columns", async () => {
  const app = await shop();
  try {
    const ctx = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
    await requestStorage.run(ctx, async () => {
      await call(["cart", "items"], "post", { product: "10" });
      await call(["cart", "address"], "put", { values: { bill_country: " ch ", bill_email: "Ann@Example.COM", cost: 99999, nonsense: 1 } });
      const order = (await cart(ctx))!;
      assertEquals(order.bill_country, "CH");             // trimmed and upper-cased
      assertEquals(order.$get("bill_email"), "ann@example.com");
      assertEquals(order.cost, 0);                        // not an address column, ignored

      // the shop sells everywhere while it marked no country, but "XX" is no country at all
      await call(["cart", "address"], "put", { values: { bill_country: "XX" } });
      assertEquals(order.bill_country, "");
    });
  } finally {
    await app.db.close();
  }
});

Deno.test("shp3 api: a line belongs to the visitor's own cart, never to an id from the request", async () => {
  const app = await shop();
  try {
    const mine = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
    let foreign = "";
    await requestStorage.run(mine, async () => {
      foreign = (await call(["cart", "items"], "post", { product: "10" })).item;
    });

    // another visitor, another session — that line is none of their business
    const other = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
    await requestStorage.run(other, async () => {
      assertEquals(await call(["cart", "items", ":id"], "put", { id: foreign, quantity: 99 }), { error: "not in your cart" });
      assertEquals(await call(["cart", "items", ":id"], "delete", { id: foreign }), { error: "not in your cart" });
    });

    await requestStorage.run(mine, async () => {
      assertEquals((await call(["cart", "items", ":id"], "put", { id: foreign, quantity: 3 })).quantity, 3);
      assertEquals((await call(["cart", "items", ":id"], "put", { id: foreign, quantity: 0 })).cart.items, 0);
    });
  } finally {
    await app.db.close();
  }
});

Deno.test("shp3 api: money comes formatted, the client does not guess the decimals", async () => {
  const app = await shop();
  try {
    const ctx = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
    await requestStorage.run(ctx, async () => {
      const prices = await call(["price"], "post", { product: "10" });
      assertEquals(prices.grossText, "12.00");

      await call(["cart", "items"], "post", { product: "10", quantity: 2 });
      assertEquals((await call(["cart"], "get")).grossText, "24.00");
    });
  } finally {
    await app.db.close();
  }
});

Deno.test("shp3 api: no endpoint shadows a name apt reserves", () => {
  // `resolve` is the param resolver of a `:id` node — an endpoint of that name breaks every
  // call below it, and only at request time.
  const walk = (node: Record<string, any>, path: string) => {
    for (const [key, child] of Object.entries(node)) {
      if (!child || typeof child !== "object") continue;
      const here = `${path}/${key}`;
      // Below a :param node, "resolve" is apt's own hook — an endpoint of that name replaces it.
      if (key.startsWith(":") && child.resolve !== undefined && typeof child.resolve !== "function") {
        throw new Error(`${here} defines "resolve" as an endpoint, which apt reserves`);
      }
      walk(child, here);
    }
  };
  walk(api as any, "shp3");
});

Deno.test("shp3 api: a page that is no product cannot be bought", async () => {
  const app = await shop();
  try {
    // a public page without a product row — naming it in a request must not make it one
    await app.db.table("page").insert({ id: 20, name: "Imprint", access: 1, module: "cms.cont.text" });
    const ctx = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
    await requestStorage.run(ctx, async () => {
      assertEquals(await call(["cart", "items"], "post", { product: "20" }), { error: "not available" });
      assertEquals(await call(["price"], "post", { product: "20" }), { error: "not available" });
    });
    assertEquals(await app.db.one`SELECT id FROM shp3_product WHERE id = ${20}`, undefined); // no row was created
  } finally {
    await app.db.close();
  }
});
