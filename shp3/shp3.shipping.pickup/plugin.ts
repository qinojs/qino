import type { App } from "../../module/core/mod.ts";
import { shp3 } from "../shp3/mod.ts";

export const name = "shp3.shipping.pickup";
export const description = "Shipping method: the customer collects the goods. Free, and it unlocks paying cash.";
export const needs = ["shp3"];

export async function init(app: App, { signal }: { signal: AbortSignal }): Promise<void> {
  await shp3(app).registerMethod("shippings", "pickup", "Abholung");

  shp3(app).on("shipping-cost", (e: { shipping: string; cost: number }) => {
    if (e.shipping === "pickup") e.cost = 0;
  }, { signal });

  // Cash needs someone to hand it to.
  shp3(app).on("payments", async (e: { order: { activeShipping(): Promise<string> }; payments: Record<string, string> }) => {
    if (await e.order.activeShipping() !== "pickup") delete e.payments.cash;
  }, { signal });
}
