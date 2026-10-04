import { ApiError, errMsg } from "@qino/qino";

import { saveSettings } from "./settings.ts";

import type { Node } from "@qino/qino/cms";

export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  try {
    if (vars.config !== undefined) {
      await saveSettings(node.app, vars.config);
      return { ok: true, message: await node.app.t`Settings saved. Reconnecting.` };
    }
    if (vars.action === undefined) return false;
    if (typeof vars.provider !== "string" || typeof vars.action !== "string" || !vars.action)
      throw new ApiError(400, "Select a provider and an action");
    const result = await node.app.api.home.provider(vars.provider).action(vars.action).post({
      entities: vars.entities, data: vars.data,
    });
    const detail = result == null ? "" : "\n" + JSON.stringify(result, null, 2);
    return { ok: true, message: (await node.app.t`Action accepted`) + detail, result };
  } catch (e) {
    return { ok: false, message: errMsg(e) };
  }
}
