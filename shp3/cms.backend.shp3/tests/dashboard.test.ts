import { assertEquals, assertStringIncludes } from "@std/assert";
import { App, Ctx, requestStorage } from "../../../module/core/mod.ts";
import { cms } from "../../../module/cms/mod.ts";
import { backendDashboardWidget as ordersWidget } from "../../cms.backend.shp3.orders1/plugin.ts";
import { backendDashboardWidget as productsWidget } from "../../cms.backend.shp3.products/plugin.ts";
import { backendDashboardWidget as settingsWidget } from "../../cms.backend.shp3.settings/plugin.ts";

const BACKEND = ["cms.backend.shp3", "cms.backend.shp3.orders1", "cms.backend.shp3.products", "cms.backend.shp3.settings"];

async function shop() {
  const app = new App({ db: "sqlite::memory:", appPATH: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../../module/store.json"))
    .add("cms").add("cms.backend").add("cron").add("locale.country").add("locale.currency");
  app.modules.add(import.meta.resolve("../../shp3/plugin.ts"), "shp3");
  for (const m of BACKEND) app.modules.add(import.meta.resolve(`../../${m}/plugin.ts`), m);
  await app.init(); // install() runs on first link
  return app;
}

Deno.test("backend.shp3: the shop pages hang under one overview", async () => {
  const app = await shop();
  try {
    const c = cms(app);
    const overview = await c.nodeByModule("cms.backend.shp3");
    assertEquals(!!overview, true);
    const page = await (await overview!.page()).parent();
    assertEquals(await (await c.nodeByModule("cms.backend"))!.page().then((p) => p.id), page!.id);

    for (const m of BACKEND.slice(1)) {
      const node = await c.nodeByModule(m);
      const parent = await (await node!.page()).parent();
      assertEquals(parent!.id, (await overview!.page()).id, `${m} sits under the overview`);
    }
  } finally {
    await app.db.close();
  }
});

Deno.test("backend.shp3: every shop page reports its numbers to the overview", async () => {
  const app = await shop();
  try {
    await app.db.table("page").insert({ id: 90, name: "Cup", access: 1 });
    await app.db.table("shp3_product").insert({ id: 90, price: 12 });
    await app.db.table("shp3_product").insert({ id: 91, price: 0 });
    await app.db.table("shp3_order").insert({ time_ordered: 1000, cost: 12, paid: 0 });
    await app.db.table("shp3_order").insert({ time_ordered: 0 });
    await app.settings.shp3.location.country("CH");
    await app.db.table("country").update({ id: "CH", shp3_enabled: true });

    const ctx = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
    await requestStorage.run(ctx, async () => {
      const orders = String(await ordersWidget(app));
      assertStringIncludes(orders, "<td>1"); // one placed, one open, one unpaid
      assertStringIncludes(orders, "shp3_orderId="); // and the newest ones, each linked
      assertEquals(orders.includes("[object Promise]"), false);
      const products = String(await productsWidget(app));
      assertStringIncludes(products, "<td>2");
      const settings = String(await settingsWidget(app));
      assertStringIncludes(settings, "Switzerland"); // the shop's country, named by Intl
      assertStringIncludes(settings, "<td>1 ");
    });
  } finally {
    await app.db.close();
  }
});
