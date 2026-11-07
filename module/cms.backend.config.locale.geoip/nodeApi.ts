import { geoip, NAMES } from "@qino/qino/locale.geoip";

import type { Node } from "@qino/qino/cms";

export default async function (node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (await node.access() < 2) return false;
  const { app } = node;

  if ("source" in vars) {
    const source = String(vars.source);
    if (!(NAMES as string[]).includes(source)) return false;
    await app.settings["locale.geoip"].source(source);
    return { source };
  }

  if ("ip" in vars) return { country: await geoip.country(app, String(vars.ip).trim()) ?? null };

  // Fetching reaches outside — say why it failed, do not swallow it.
  if ("now" in vars) {
    const res = await geoip.update(app).catch((e: Error) => e);
    return res instanceof Error ? { error: res.message } : res;
  }

  return false;
}
