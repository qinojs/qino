// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "@std/assert";
import { App, Ctx, requestStorage } from "../../../module/core/mod.ts";
import { api } from "../apt.ts";
import { cart } from "../mod.ts";
import nodeApi from "../../cms.backend.shp3.orders1/nodeApi.ts";
import { mail } from "../../../module/mail/mod.ts";

const call = (path: string[], verb: string, input?: unknown) =>
  (path.reduce((n: any, k) => n[k], api as any))[verb].execute(input);

async function shop(...extra: string[]) {
  const app = new App({ db: "sqlite::memory:", appPATH: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../../module/store.json")).add("cms").add("mail").add("cron").add("cron").add("locale.country").add("locale.currency");
  app.modules.add(import.meta.resolve("../plugin.ts"), "shp3");
  for (const m of ["shp3.shipping.pickup", "shp3.payment.invoice", "shp3.payment.advance", "cms.cont.shp3.order.addresses2", ...extra]) {
    app.modules.add(import.meta.resolve(`../../${m}/plugin.ts`), m);
  }
  await app.init();
  await app.db.table("page").insert({ id: 10, name: "Cup", access: 1 });
  await app.db.table("shp3_product").insert({ id: 10, price: 12, weight: 0.5 });
  return app;
}

Deno.test("shp3: a whole order, from the empty cart to the placed one", async () => {
  const app = await shop();
  try {
    const ctx = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
    await requestStorage.run(ctx, async () => {
      // nothing in the cart — the checkout says so instead of placing an empty order
      assertEquals(await call(["cart", "order"], "post", {}), { success: false, errors: {}, redirect: "" });

      await call(["cart", "items"], "post", { product: "10", quantity: 2 });

      // Two payment methods, and this shop wants a deliberate choice — a single method would
      // always be taken, whatever the setting says.
      await app.settings.shp3.auto_select_payment("");
      const early = await call(["cart", "order"], "post", {});
      assertEquals(early.success, false);
      assertEquals(Object.keys(early.errors), ["has payment"]); // pickup is the only shipping, auto-chosen

      await call(["cart", "address"], "put", {
        values: { bill_firstname: "Tobias", bill_lastname: "B", bill_street: "Weg 1", bill_zip: "8000", bill_city: "Zürich", bill_country: "CH", bill_email: "t@example.test" },
      });
      await call(["cart", "shipping"], "put", { value: "pickup" });
      await call(["cart", "payment"], "put", { value: "invoice" });

      const placed = await call(["cart", "order"], "post", {});
      assertEquals(placed.errors, {});
      assertEquals(placed.success, true);

      const order = await app.db.table("shp3_order").get(placed.order) as any;
      assertEquals(order.payment, "invoice");
      assertEquals(order.shipping, "pickup");
      assertEquals(order.ship_country, "CH");
      assertEquals(order.cost, 24);
      assertEquals(order.bill_email, "t@example.test");

      // the placed order is spent: the next look gets a fresh, empty cart
      assertEquals((await cart(ctx))!.$id !== order.$id, true);
      assertEquals((await call(["cart"], "get")).items, 0);
    });
  } finally {
    await app.db.close();
  }
});

Deno.test("shp3 backend: an order is paid off, an open cart can still be placed", async () => {
  const app = await shop();
  try {
    const ctx = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
    await requestStorage.run(ctx, async () => {
      await call(["cart", "items"], "post", { product: "10", quantity: 2 });
      await call(["cart", "payment"], "put", { value: "invoice" });
      const id = (await call(["cart", "order"], "post", {})).order;

      const node = { access: () => 2, app, cms: null } as any;
      const order = await app.db.table("shp3_order").get(id) as any;
      assertEquals(order.cost, 24);
      assertEquals(Number(order.paid), 0);

      assertEquals(await nodeApi(node, { pay: id }), { paid: 24 });
      // a second click must not double the payment
      assertEquals(await nodeApi(node, { pay: id }), { paid: 24 });
    });
  } finally {
    await app.db.close();
  }
});

Deno.test("shp3: ordering sends the confirmation", async () => {
  const app = await shop("shp3.messages2");
  try {
    mail(app).setTransport({ send: () => Promise.resolve({ ok: true }) } as never);
    const sent: { to: string[]; subject: string; html: string }[] = [];
    app.db.on("table:insert-before", (e: any) => {
      if (e.table.name === "mail") sent.push({ to: [], subject: e.data.subject, html: e.data.html ?? "" });
    });
    app.db.on("table:insert-before", (e: any) => {
      if (e.table.name === "mail_recipient") sent.at(-1)?.to.push(e.data.email);
    });

    const ctx = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
    await requestStorage.run(ctx, async () => {
      await call(["cart", "items"], "post", { product: "10", quantity: 2 });
      await call(["cart", "address"], "put", { values: { bill_email: "kunde@example.test", bill_lastname: "B" } });
      await call(["cart", "payment"], "put", { value: "invoice" });
      await call(["cart", "order"], "post", {});
    });

    assertEquals(sent.length, 1);
    assertEquals(sent[0].to, ["kunde@example.test"]);
    assertEquals(sent[0].html.includes("24.00"), true); // the total is in the mail
  } finally {
    await app.db.close();
  }
});

Deno.test("shp3: a confirmation that cannot go out does not undo the order", async () => {
  const app = await shop("shp3.messages2");
  try {
    // No transport at all — exactly what an unconfigured shop looks like on its first sale.
    const ctx = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
    await requestStorage.run(ctx, async () => {
      await call(["cart", "items"], "post", { product: "10" });
      await call(["cart", "address"], "put", { values: { bill_email: "kunde@example.test" } });
      await call(["cart", "payment"], "put", { value: "invoice" });
      const placed = await call(["cart", "order"], "post", {});
      assertEquals(placed.success, true);
      assertEquals((await app.db.table("shp3_order").get(placed.order) as any).time_ordered > 0, true);
    });
  } finally {
    await app.db.close();
  }
});
