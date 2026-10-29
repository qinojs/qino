import { errMsg } from "@qino/qino";
import { run, trigger } from "@qino/qino/cron";

import type { Node } from "@qino/qino/cms";

export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  try {
    const result = typeof vars.runJob === "string"
      ? await trigger(node.app, vars.runJob)
      : vars.runDue ? await run(node.app) : undefined;
    if (!result) return false;
    const errors = Object.values(result.failed);
    const runLabel = result.ran.length === 1 ? await node.app.t`job run` : await node.app.t`jobs run`;
    return { ok: !errors.length, message: errors.join("\n") || `${result.ran.length} ${runLabel}` };
  } catch (e) {
    return { ok: false, message: errMsg(e) };
  }
}
