import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { renderRows, saveRows } from "@qino/qino/cms.backend.shop";
import { currencyFor, mainCurrency, shopT } from "@qino/qino/cms.shop";

import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Rows } from "@qino/qino/cms.backend.shop";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Shipping", de: "Versand" });
}
export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

async function tables(app: App): Promise<Rows[]> {
  const t = shopT(app);
  const main = (await mainCurrency(app))?.$id ?? "";
  // free from an amount in the currency that country pays in
  const ids = await app.db.col<string>`SELECT DISTINCT country FROM shop_shipping_free`;
  const paid = new Map(await Promise.all(ids.map(async (id) => [id, (await currencyFor(app, id))?.$id ?? main] as const)));
  return [{
    table: "shop_shipping_rate",
    title: `${await t`Rates`} (${main})`,
    order: ["country", "method", "weight"],
    columns: [
      { name: "country", label: t`Country` },
      { name: "method", label: t`Tariff` },
      { name: "weight", label: t`Up to grams`, type: "number" },
      { name: "price", label: t`Price`, type: "money", currency: () => main },
    ],
  }, {
    table: "shop_shipping_free",
    title: t`Free from`,
    order: ["country", "method"],
    columns: [
      { name: "country", label: t`Country` },
      { name: "method", label: t`Tariff` },
      { name: "amount", label: t`Goods worth`, type: "money", currency: (row) => paid.get(String(row.country)) ?? main },
    ],
  }];
}

async function render(node: Node) {
  return html.async`<div class=u2-flex>${(await tables(node.app)).map((spec) => renderRows(node, spec))}</div>`;
}
const api = async (node: Node, vars: Record<string, unknown>) => saveRows(node, await tables(node.app), vars);

export const cms = { node: { render, api, js: ["../cms.backend.shop/pub/rows.js"] } };
