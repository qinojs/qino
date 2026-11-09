import { cms as cmsOf } from "@qino/qino/cms";
import { backend } from "@qino/qino/cms.backend";
import { rowsPage } from "@qino/qino/cms.backend.shop";
import { shopT } from "@qino/qino/cms.shop";

import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";
import type { Rows } from "@qino/qino/cms.backend.shop";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Discounts", de: "Rabatte" });
}
export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

async function rows(app: App): Promise<Rows> {
  const t = shopT(app);
  const groups = await app.db.query`SELECT id, name FROM grp ORDER BY name`;
  return {
    table: "shop_discount",
    title: t`Discounts`,
    order: ["node_id", "grp_id", "min_quantity"],
    columns: [
      { name: "title", label: t`Title` },
      { name: "node_id", label: t`Product or category`, type: "page" },
      { label: "", show: async (row) => Number(row.node_id) ? (await cmsOf(app).node(Number(row.node_id))).showTitle() : await t`All products` },
      { name: "grp_id", label: t`Group`, type: "select", options: [["0", await t`Everybody`], ...groups.map((g) => [String(g.id), String(g.name)] as [string, string])] },
      { name: "min_quantity", label: t`From quantity`, type: "number" },
      { name: "per_line", label: t`Per line`, type: "checkbox" },
      { name: "factor", label: t`Factor`, type: "number" },
      { name: "start", label: t`From`, type: "date" },
      { name: "end", label: t`Until`, type: "date", until: true },
    ],
  };
}

export const cms = { node: rowsPage(async (app) => [await rows(app)]) };
