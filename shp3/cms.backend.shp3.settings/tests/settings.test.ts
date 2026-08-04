import { assertEquals, assertStringIncludes } from "@std/assert";
import { App, Ctx, requestStorage } from "../../../module/core/mod.ts";
import type { Node } from "../../../module/cms/mod.ts";
import nodeApi from "../nodeApi.ts";
import { cms as panel } from "../plugin.ts";

async function shop() {
  const app = new App({ db: "sqlite::memory:", appPATH: await Deno.makeTempDir() + "/" });
  app.stores.add(import.meta.resolve("../../../module/store.json")).add("cms").add("cron").add("locale.country").add("locale.currency");
  app.modules.add(import.meta.resolve("../../shp3/plugin.ts"), "shp3");
  await app.init();
  return app;
}

// The panel talks to its own node api; access is the only gate it has.
const call = (app: App, vars: Record<string, unknown>, access = 2) =>
  nodeApi({ access: () => Promise.resolve(access), app } as unknown as Node, vars);

Deno.test("backend.shp3.settings: writes only the settings it offers", async () => {
  const app = await shop();
  try {
    await call(app, { setting: "location.country", value: "CH" });
    assertEquals(String(await app.settings.shp3.location.country), "CH");

    await call(app, { setting: "vat.mode", value: false }); // the checkbox is the mode
    assertEquals(String(await app.settings.shp3.vat.mode), "excluded");

    assertEquals(await call(app, { setting: "payments.invoice.enabled", value: "1" }), false);
    assertEquals(await call(app, { setting: "location.country", value: "DE" }, 1), false); // no access
    assertEquals(String(await app.settings.shp3.location.country), "CH");
  } finally {
    await app.db.close();
  }
});

Deno.test("backend.shp3.settings: a country is marked and rated, an unknown one refused", async () => {
  const app = await shop();
  try {
    assertEquals(await call(app, { country: "CH", field: "shp3_enabled", value: true }), 1);
    assertEquals(await call(app, { country: "CH", field: "shp3_default_vat_rate", value: "8.1" }), 1);
    assertEquals(await app.db.one`SELECT shp3_default_vat_rate FROM country WHERE id = ${"CH"}`, 8.1);

    // an empty rate means "no rate of its own", not zero percent
    await call(app, { country: "CH", field: "shp3_default_vat_rate", value: "" });
    assertEquals(await app.db.one`SELECT shp3_default_vat_rate FROM country WHERE id = ${"CH"}`, null);

    assertEquals(await call(app, { country: "QQ", field: "shp3_enabled", value: true }), false);
    assertEquals(await call(app, { country: "CH", field: "shp3_currency", value: "x" }), false);
  } finally {
    await app.db.close();
  }
});

Deno.test("backend.shp3.settings: switching the main currency rescales every factor", async () => {
  const app = await shop();
  const db = app.db;
  try {
    assertEquals(await db.one`SELECT factor FROM shp3_currency WHERE id = ${"EUR"}`, 0.91); // CHF is main

    await call(app, { currency: "EUR", field: "main", value: true });
    assertEquals(await db.one`SELECT factor FROM shp3_currency WHERE id = ${"EUR"}`, 1);
    assertEquals(await db.one`SELECT active FROM shp3_currency WHERE id = ${"EUR"}`, 1);
    assertEquals(Number(await db.one`SELECT factor FROM shp3_currency WHERE id = ${"CHF"}`).toFixed(4), "1.0989");
    assertEquals(await db.one`SELECT count(*) FROM shp3_currency WHERE main = ${true}`, 1);

    assertEquals(await call(app, { currency: "EUR", field: "nonsense", value: 1 }), false);
  } finally {
    await app.db.close();
  }
});

Deno.test("backend.shp3.settings: the panel renders every box, nothing left unresolved", async () => {
  const app = await shop();
  try {
    await app.db.table("country").update({ id: "CH", shp3_enabled: true });
    const ctx = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
    await requestStorage.run(ctx, async () => {
      const html = String(await panel.node.render({ app } as unknown as Node));
      assertEquals(html.includes("[object Promise]"), false); // t`…` needs html.async, not html``
      assertStringIncludes(html, "data-setting=location.country");
      assertStringIncludes(html, "data-field=smallest_closing");
      assertStringIncludes(html, "Switzerland"); // named by Intl in the backend language
      assertStringIncludes(html, "class=-search"); // the rest of the world is searchable
    });
  } finally {
    await app.db.close();
  }
});

Deno.test("backend.shp3.settings: a factor the rate job owns is not edited here", async () => {
  const app = await shop();
  try {
    assertEquals(await call(app, { currency: "EUR", field: "factor", value: 0.95 }), 1); // no job: the shop's own

    await app.settings["locale.currency"].update("daily");
    assertEquals(await call(app, { currency: "EUR", field: "factor", value: 2 }), false);
    assertEquals(await app.db.one`SELECT factor FROM shp3_currency WHERE id = ${"EUR"}`, 0.95);
    assertEquals(await call(app, { currency: "EUR", field: "smallest", value: 0.05 }), 1); // the rest stays editable

    const ctx = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
    await requestStorage.run(ctx, async () => {
      const html = String(await panel.node.render({ app } as unknown as Node));
      assertStringIncludes(html, "factors follow the exchange rates");
    });
  } finally {
    await app.db.close();
  }
});

Deno.test("backend.shp3.settings: every currency is offered, the shop picks", async () => {
  const app = await shop();
  try {
    await app.db.table("country").update({ id: "JP", shp3_enabled: true }); // pays in JPY
    const ctx = await Ctx.create(app, new Request("http://shop.test/"), { appUrl: "/" });
    await requestStorage.run(ctx, async () => {
      const html = String(await panel.node.render({ app } as unknown as Node));
      assertStringIncludes(html, 'itemid=JPY'); // not in shp3_currency, still listed
      assertStringIncludes(html, "-needed"); // and marked: an active country pays in it
    });

    // ticking "active" takes it on
    assertEquals(await call(app, { currency: "JPY", field: "active", value: true }), 1);
    assertEquals(await app.db.one`SELECT active FROM shp3_currency WHERE id = ${"JPY"}`, 1);
    assertEquals(await call(app, { currency: "QQQ", field: "active", value: true }), false);
    // an untouched one stays out of the shop's list
    assertEquals(await app.db.one`SELECT id FROM shp3_currency WHERE id = ${"NOK"}`, undefined);
  } finally {
    await app.db.close();
  }
});
