import { ApiError, errMsg } from "@qino/qino";
import { call, configure, datapoints, enable, removeCommand, run, save, saveCommand } from "@qino/qino/home";
import { record } from "@qino/qino/home.record";

import type { App } from "@qino/qino";
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
      const input = vars.datapoint as Parameters<typeof configure>[1];
      // A new source with an existing interpretation reuses that datapoint instead of creating one.
      const known = input.id === undefined ? (await datapoints(app, input.provider)).map((point) => point.id) : [];
      const id = await configure(app, input);
      if (known.includes(id)) return { ok: true, message: `${await app.t`Existing datapoint updated`} (#${id}).` };
      return { ok: true, message: await app.t`Datapoint saved.` };
    }
    if (vars.measurement !== undefined) {
      const { id, value, time } = vars.measurement as Vars;
      if (!app.modules.linked("home.record")) throw new ApiError(501, "Install home.record to store measurements");
      if (typeof value !== "number" || typeof time !== "number") throw new ApiError(400, "Enter a valid value and time");
      await record(app, Number(id), value, time);
      return { ok: true, message: await app.t`Measurement saved.` };
    }
    if (vars.command !== undefined) {
      await saveCommand(app, vars.command as Parameters<typeof saveCommand>[1]);
      return { ok: true, message: await app.t`Command saved.` };
    }
    if (vars.removeCommand !== undefined) {
      await removeCommand(app, Number(vars.removeCommand));
      return { ok: true, message: await app.t`Command deleted.` };
    }
    if (vars.run !== undefined) return accepted(app, await run(app, Number(vars.run), { value: vars.value }));
    if (vars.action === undefined) return false;
    if (!Number.isSafeInteger(vars.provider) || typeof vars.action !== "string" || !vars.action)
      throw new ApiError(400, "Select a provider and action");
    const { entities, data } = vars;
    if (entities !== undefined && !(Array.isArray(entities) && entities.every((id) => typeof id === "string")))
      throw new ApiError(400, "Target entities must be a list of IDs");
    if (data !== undefined && (!data || typeof data !== "object" || Array.isArray(data)))
      throw new ApiError(400, "Action data must be a JSON object");
    const input = { entities, data } as Parameters<typeof call>[3];
    return accepted(app, await call(app, Number(vars.provider), vars.action, input));
  } catch (error) { return { ok: false, message: errMsg(error) }; }
}

/** An acknowledgement, not the device state: that arrives as an observation. */
async function accepted(app: App, result: unknown) {
  const detail = result == null ? "" : "\n" + JSON.stringify(result, null, 2);
  return { ok: true, message: (await app.t`Action accepted`) + detail, result };
}
