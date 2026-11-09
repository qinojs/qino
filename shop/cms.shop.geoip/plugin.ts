import { geoip } from "@qino/qino/locale.geoip";
import { listen, sellsTo } from "@qino/qino/cms.shop";

import type { App, Ctx } from "@qino/qino";
import type { Order } from "@qino/qino/cms.shop";

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  // A fresh cart starts in the visitor's country, where the shop delivers there; in memory, no query.
  listen(app, signal)("shop:cart", async ({ order, ctx }: { order: Order; ctx: Ctx }) => {
    const country = await geoip.country(app, ctx.req.clientIp);
    if (country && country !== order.country && await sellsTo(app, country)) await order.setCountry(country);
  });
}
