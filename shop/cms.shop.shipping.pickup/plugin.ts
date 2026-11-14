import { shopT } from "@qino/qino/cms.shop";

import type { App } from "@qino/qino";
import type { ShippingProvider } from "@qino/qino/cms.shop";

/** Collected by the customer: costs nothing. */
export const shippingProvider: ShippingProvider = {
  name: "pickup",
  methods: (app: App) => shippingProvider.all(app),
  all: async (app: App) => [{ name: "", label: await shopT(app)`Pickup` }],
  cost: () => 0,
};
