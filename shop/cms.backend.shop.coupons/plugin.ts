import { backend } from "@qino/qino/cms.backend";
import { rowsPage } from "@qino/qino/cms.backend.shop";
import { shopT } from "@qino/qino/cms.shop";

import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";
import type { Rows } from "@qino/qino/cms.backend.shop";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Coupons", de: "Gutscheine" });
}
export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

const tables = async (app: App): Promise<Rows[]> => {
  const t = shopT(app);
  return [{
    table: "shop_coupon",
    title: t`Coupons`,
    order: ["-start", "code"],
    columns: [
      { name: "code", label: t`Code` },
      { name: "title", label: t`Title` },
      { name: "type", label: t`Kind`, type: "select", options: [["percent", await t`Percent`], ["money", await t`Amount`]] },
      { name: "value", label: t`Value`, type: "number" },
      { name: "node_id", label: t`Product or category`, type: "page" },
      { name: "constant", label: t`Stays`, type: "checkbox" },
      { name: "once", label: t`Once per customer`, type: "checkbox" },
      { name: "start", label: t`From`, type: "date" },
      { name: "end", label: t`Until`, type: "date" },
    ],
  }];
};

export const cms = { node: rowsPage(tables) };
