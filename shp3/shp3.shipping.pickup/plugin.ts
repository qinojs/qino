import { shp3 } from "@qino/qino/shp3";

import type { App } from "@qino/qino";

export async function init(app: App, { signal }: { signal: AbortSignal }): Promise<void> {
  await shp3(app).registerMethod("shippings", "pickup", "Abholung");

  shp3(app).on("shipping-cost", (e) => {
    if (e.shipping === "pickup") e.cost = 0;
  }, { signal });

  // Cash needs someone to hand it to.
  shp3(app).on("payments", async (e) => {
    if (await e.order.activeShipping() !== "pickup") delete e.payments.cash;
  }, { signal });
}
