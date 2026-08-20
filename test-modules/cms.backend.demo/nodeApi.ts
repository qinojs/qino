import { reset, wipe } from "./mod.ts";

import type { Node } from "@qino/qino/cms";

export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (await node.access() < 2) return false;
  const t = node.app.t;

  if (vars.wipe) {
    const gone = await wipe(node.app);
    return { message: `${gone} ${await t`rows removed`}` };
  }
  if (vars.fill) {
    const only = Array.isArray(vars.only) ? vars.only.map(String) : undefined;
    const seed = await reset(node.app, { only, scale: Number(vars.scale) || 1 });
    const what = Object.entries(seed.counts).map(([kind, n]) => `${n} ${kind}`).join(", ");
    return { message: `${await t`Created`}: ${what || "—"}` };
  }
  return false;
}
