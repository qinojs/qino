import { shopT, taxRate } from "@qino/qino/cms.shop";

import type { App } from "@qino/qino";
import type { Extra, Order } from "@qino/qino/cms.shop";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const settingsSchema = {
  properties: {
    exclude: { type: "string", description: "Nodes (comma separated) whose products do not count towards the minimum — courses, vouchers." },
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  const t = shopT(app);
  // Goods below the minimum of the order's currency cost a surcharge, a line of its own.
  app.on("shop:extras", (async ({ order, extras }: { order: Order; extras: Extra[] }) => {
    const currency = await order.currencyRow();
    const minimum = Number(currency?.$get("minimum") ?? 0), surcharge = Number(currency?.$get("minimum_surcharge") ?? 0);
    if (!minimum || !surcharge) return;
    const exclude = String(await app.settings["cms.shop.minimum"].exclude ?? "").split(",").map(Number).filter(Boolean);
    let goods = 0;
    for (const line of await order.lines()) {
      const node = await (await line.product())?.node();
      if (node && (await Promise.all(exclude.map((id) => node.in(id)))).some(Boolean)) continue;
      goods += order.tax_included ? line.total() : line.total() * ((await line.taxRate()) / 100 + 1);
    }
    if (!goods || goods >= minimum) return;
    const price = order.tax_included ? surcharge : surcharge / ((await taxRate(app, order.country)) / 100 + 1);
    extras.push({ key: "minimum", name: await t`Small quantity surcharge`, price, taxRate: await taxRate(app, order.country), sort: 1 });
  }) as never, { signal });
}
