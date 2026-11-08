import { shopT } from "@qino/qino/cms.shop";

import { countriesOf } from "./mod.ts";

import type { App } from "@qino/qino";
import type { Line } from "@qino/qino/cms.shop";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  const t = shopT(app);
  app.on("shop:line-check", (async ({ line, errors }: { line: Line; errors: Record<string, string> }) => {
    const [order, allowed] = await Promise.all([line.order(), countriesOf(app, line.product_id)]);
    if (order && allowed.length && !allowed.includes(order.country)) {
      errors["country"] = `${await t`This product cannot be sent to your country`}: ${order.country}`;
    }
  }) as never, { signal });
}
