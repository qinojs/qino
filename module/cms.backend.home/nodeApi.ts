import { ApiError, errMsg } from "@qino/qino";

import type { Datapoint } from "@qino/qino/home";
import type { Node } from "@qino/qino/cms";

export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  try {
    if (vars.config !== undefined) {
      const input = vars.config as Record<string, unknown>;
      const { id, ...config } = input;
      if (id !== undefined) await node.app.api.home.provider(Number(id)).put(config);
      else await node.app.api.home.providers.post(config);
      return { ok: true, message: await node.app.t`Provider saved.` };
    }
    if (vars.enabled !== undefined) {
      await node.app.api.home.provider(Number(vars.provider)).patch({ enabled: vars.enabled });
      return { ok: true, message: await node.app.t`Provider updated.` };
    }
    if (vars.datapoint !== undefined) {
      const input = vars.datapoint as Record<string, unknown>, { id, ...config } = input;
      if (id !== undefined) await node.app.api.home.datapoint(Number(id)).put(config);
      else await node.app.api.home.datapoints.post(config);
      return { ok: true, message: await node.app.t`Datapoint saved.` };
    }
    if (vars.measurement !== undefined) {
      const input = vars.measurement as Record<string, unknown>, { id, ...sample } = input;
      const point = await node.app.api.home.datapoint(Number(id)).get() as Datapoint;
      if (!point.record) throw new ApiError(409, "Enable recording before entering measurements");
      await node.app.api["home.record"].datapoint(Number(id)).post(sample);
      return { ok: true, message: await node.app.t`Measurement saved.` };
    }
    if (vars.action === undefined) return false;
    if (!Number.isSafeInteger(vars.provider) || typeof vars.action !== "string" || !vars.action) throw new ApiError(400, "Select a provider and action");
    const result = await node.app.api.home.provider(Number(vars.provider)).action(vars.action).post({ entities: vars.entities, data: vars.data });
    const detail = result == null ? "" : "\n" + JSON.stringify(result, null, 2);
    return { ok: true, message: (await node.app.t`Action accepted`) + detail, result };
  } catch (error) { return { ok: false, message: errMsg(error) }; }
}
