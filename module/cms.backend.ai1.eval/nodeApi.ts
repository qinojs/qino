import { errMsg } from "@qino/qino";

import { BENCHMARKS_KEY, evaluate } from "./lib/eval.ts";

import type { Node } from "@qino/qino/cms";

/** Node access is the permission. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  try {
    if (vars.evaluate) return { ok: true, message: await evaluate(app) };
    if ("key" in vars) {
      await app.settings.core.keys[BENCHMARKS_KEY](String(vars.key ?? "").trim() || undefined);
      return { ok: true, message: await app.t`Saved.` };
    }
    return null;
  } catch (e) {
    return { ok: false, message: errMsg(e) };
  }
}
