import { getCtx, html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { renderRows, saveRows } from "@qino/qino/cms.backend.shop";
import { shopT } from "@qino/qino/cms.shop";
import { country } from "@qino/qino/locale.country";

import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Column, Rows } from "@qino/qino/cms.backend.shop";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Currencies and countries", de: "Währungen und Länder" });
}
export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

async function tables(app: App): Promise<Rows[]> {
  const t = shopT(app), own = (row: Record<string, unknown>) => String(row.id);
  const currencies = await app.db.col<string>`SELECT id FROM shop_currency ORDER BY id`;
  const minimum: Column[] = app.modules.get("cms.shop.minimum")
    ? [{ name: "minimum", label: t`Minimum order`, type: "money", currency: own }, { name: "minimum_surcharge", label: t`Surcharge below it`, type: "money", currency: own }]
    : [];
  return [{
    table: "shop_currency",
    title: t`Currencies`,
    order: ["id"],
    columns: [
      { name: "id", label: "ISO" },
      { name: "factor", label: t`Factor`, type: "number" },
      { name: "rounding", label: t`Rounding step`, type: "number" },
      { name: "active", label: t`Active`, type: "checkbox" },
      { name: "main", label: t`Main`, type: "checkbox" },
      ...minimum,
    ],
  }, {
    table: "country",
    title: t`Countries`,
    fixed: true,
    order: ["id"],
    columns: [
      { label: t`Country`, show: (row) => `${row.id} ${country.name(String(row.id), getCtx().lang)}` },
      { name: "shop_enabled", label: t`Delivers there`, type: "checkbox" },
      { name: "shop_tax_rate", label: t`VAT %`, type: "number" },
      { name: "shop_currency", label: t`Pays in`, type: "select", options: [["", ""], ...currencies.map((c) => [c, c] as [string, string])] },
    ],
  }];
}

async function render(node: Node) {
  return html.async`<div class=u2-flex>${(await tables(node.app)).map((spec) => renderRows(node, spec))}</div>`;
}
const api = async (node: Node, vars: Record<string, unknown>) => saveRows(node, await tables(node.app), vars);

export const cms = { node: { render, api, js: ["../cms.backend.shop/pub/rows.js"] } };
