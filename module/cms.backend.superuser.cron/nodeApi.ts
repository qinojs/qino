import type { Node } from "../cms/mod.ts";
import { run, trigger } from "../cron/mod.ts";

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
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
