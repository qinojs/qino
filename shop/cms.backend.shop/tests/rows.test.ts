import { test } from "node:test";
import { assertEquals, assert } from "@qino/qino/tests";
import { sql } from "@qino/qino";
import { cms } from "@qino/qino/cms";

import { asVisitor, withShop } from "../../tests/app.ts";
import { renderRows, saveRows } from "../rows.ts";

import type { Rows } from "../rows.ts";

const rates: Rows = {
  table: "shop_shipping_rate", title: "Rates", order: ["country", "method", "weight"],
  columns: [
    { name: "country", label: "Country" }, { name: "method", label: "Method" }, { name: "weight", label: "Grams", type: "number" },
    { name: "price", label: "Price", type: "money", currency: () => "CHF" },
  ],
};

test("a table of rows: added, changed by its other columns only, removed, none but the page's own", async () => {
  await withShop(["cms.shop.shipping.weight"], async (app) => {
    await asVisitor(app, async () => {
      const node = await cms(app).node(10), db = app.db;
      assertEquals(await saveRows(node, [rates], { table: "usr", values: { email: "x" } }), undefined);
      assertEquals((await saveRows(node, [rates], { table: rates.table, values: { country: "CH", method: "a", weight: "500", price: "9.50" } }))?.ok, true);
      assertEquals(await db.row`SELECT country, method, weight, price FROM shop_shipping_rate`, { country: "CH", method: "a", weight: 500, price: 950 });
      const id = "CH:a:500";
      assert(String(await renderRows(node, rates)).includes('value="9.5"'));
      await saveRows(node, [rates], { table: rates.table, id, values: { country: "DE", price: "12" } }); // a key stays
      assertEquals(await db.row`SELECT country, price FROM shop_shipping_rate`, { country: "CH", price: 1200 });
      assertEquals((await saveRows(node, [rates], { table: rates.table, id: "nope:a:1", values: { price: "1" } }))?.ok, false);
      assertEquals((await saveRows(node, [rates], { table: rates.table, remove: id }))?.ok, true);
      assertEquals(await db.one`SELECT COUNT(*) FROM shop_shipping_rate`, 0);
    });
  });
});

test("what is left empty when adding takes the column's default; one row reads label beside value", async () => {
  await withShop(["cms.shop.price.discount"], async (app) => {
    await asVisitor(app, async () => {
      const node = await cms(app).node(10);
      const spec: Rows = { table: "shop_discount", title: "", columns: [{ name: "title", label: "T" }, { name: "factor", label: "F", type: "number" }] };
      await saveRows(node, [spec], { table: spec.table, values: { title: "x", factor: "" } });
      assertEquals(Number(await app.db.one`SELECT factor FROM shop_discount`), 1);
      const single = String(await renderRows(node, { ...spec, single: true, fixed: true }));
      assert(single.includes("<tbody data-id=") && single.includes("<th>T"));
    });
  });
});

test("a fixed table neither grows nor shrinks; a date holds through its last day", async () => {
  await withShop(["cms.shop.price.discount"], async (app) => {
    await asVisitor(app, async () => {
      const node = await cms(app).node(10), db = app.db;
      const spec: Rows = { table: "shop_discount", title: "", columns: [{ name: "end", label: "", type: "date", until: true }] };
      await saveRows(node, [spec], { table: spec.table, values: { end: "2026-12-31" } });
      assertEquals(Number(await db.one`SELECT ${sql.id("end")} FROM shop_discount`), Date.UTC(2027, 0, 1) / 1000);
      assert(String(await renderRows(node, spec)).includes('value="2026-12-31"'));
      const fixed = { ...spec, fixed: true };
      assertEquals((await saveRows(node, [fixed], { table: spec.table, values: { end: "" } }))?.ok, false);
      assertEquals((await saveRows(node, [fixed], { table: spec.table, remove: "1" }))?.ok, false);
    });
  });
});

test("a table of very many rows stops, and says how many there are", async () => {
  await withShop(["cms.shop.price.discount"], async (app) => {
    await asVisitor(app, async () => {
      for (let i = 0; i < 501; i++) await app.db.table("shop_discount").insert({ node_id: i + 1000, factor: 0.9 });
      const out = String(await renderRows(await cms(app).node(10), { table: "shop_discount", title: "", fixed: true, columns: [{ name: "factor", label: "F", type: "number" }] }));
      assert(out.includes("500 / 501"));
      assertEquals(out.match(/<tr data-id=/g)?.length, 500);
    });
  });
});
