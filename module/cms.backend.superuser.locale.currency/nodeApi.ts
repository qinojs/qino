import { updateRates } from "@qino/qino/locale.currency";

import type { Node } from "@qino/qino/cms";

export default async function (node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (await node.access() < 2) return false;
  const { app } = node;

  if ("every" in vars) {
    const every = String(vars.every);
    if (!["never", "daily", "hourly"].includes(every)) return false;
    await app.settings["locale.currency"].update(every);
    return { every };
  }

  // A rate by hand — for a shop that keeps its own, or a currency the source does not carry.
  // An empty value is not "zero", it means the currency has no rate.
  if ("rate" in vars) {
    const id = String(vars.rate).toUpperCase();
    if (!await app.db.one`SELECT id FROM currency WHERE id = ${id}`) return false;
    const value = String(vars.value ?? "");
    return await app.db.table("currency").update({ id, rate_to_usd: value === "" ? null : Number(value) }) ? 1 : false;
  }

  // Fetching is the one thing that reaches outside — say why it failed, do not swallow it.
  if ("now" in vars) {
    const res = await updateRates(app).catch((e: Error) => e);
    return res instanceof Error ? { error: res.message } : res;
  }

  return false;
}
