import { ApiError, errMsg } from "@qino/qino";
import { call, configure, enable, save } from "@qino/qino/home";
import { record } from "@qino/qino/home.record";

import type { Node } from "@qino/qino/cms";

type Vars = Record<string, unknown>;

export default async function api(node: Node, vars: Vars): Promise<unknown> {
  const app = node.app;
  try {
    if (vars.config !== undefined) {
      await save(app, vars.config as Parameters<typeof save>[1]);
      return { ok: true, message: await app.t`Provider saved.` };
    }
    if (vars.enabled !== undefined) {
      await enable(app, Number(vars.provider), vars.enabled === true);
      return { ok: true, message: await app.t`Provider updated.` };
    }
    if (vars.datapoint !== undefined) {
      await configure(app, vars.datapoint as Parameters<typeof configure>[1]);
      return { ok: true, message: await app.t`Datapoint saved.` };
    }
    if (vars.measurement !== undefined) {
      const { id, value, time } = vars.measurement as Vars;
      if (!app.modules.linked("home.record")) throw new ApiError(501, "Install home.record to store measurements");
      if (typeof value !== "number" || typeof time !== "number") throw new ApiError(400, "Enter a valid value and time");
      await record(app, Number(id), value, time);
      return { ok: true, message: await app.t`Measurement saved.` };
    }
    if (vars.action === undefined) return false;
    if (!Number.isSafeInteger(vars.provider) || typeof vars.action !== "string" || !vars.action)
      throw new ApiError(400, "Select a provider and action");
    const { entities, data } = vars;
    if (entities !== undefined && !(Array.isArray(entities) && entities.every((id) => typeof id === "string")))
      throw new ApiError(400, "Target entities must be a list of IDs");
    if (data !== undefined && (!data || typeof data !== "object" || Array.isArray(data)))
      throw new ApiError(400, "Action data must be a JSON object");
    const result = await call(app, Number(vars.provider), vars.action, { entities, data } as Parameters<typeof call>[3]);
    const detail = result == null ? "" : "\n" + JSON.stringify(result, null, 2);
    return { ok: true, message: (await app.t`Action accepted`) + detail, result };
  } catch (error) { return { ok: false, message: errMsg(error) }; }
}
