import { getCtx, requireStepUp } from "@qino/qino";

import { call } from "./lib/helper.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { Node } from "@qino/qino/cms";

/** `start`, `stop`, `restart` and `log` take `name`; `create` (`domain`, `template`) and `delete` (`name`)
 *  need a fresh passkey or other step-up. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const socket = String(await node.app.settings[manifest.name].socket);
  const { verb, name, domain, template } = vars;
  if (verb === "log") return { log: await call(socket, "log", { name }) };
  if (verb === "start" || verb === "stop" || verb === "restart") {
    await call(socket, verb, { name });
    return { ok: true };
  }
  if (verb === "create") {
    await requireStepUp(getCtx());
    return await call(socket, "create", { domain, template }, 10 * 60_000);
  }
  if (verb === "delete") {
    await requireStepUp(getCtx());
    return await call(socket, "delete", { name });
  }
  return false;
}
